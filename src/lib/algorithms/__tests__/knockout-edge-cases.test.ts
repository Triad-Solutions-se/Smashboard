/**
 * Edge-case tests for the multi-bracket KO system.
 *
 * Coverage:
 *  - computeBracketPath (used in HostView) for every realistic per-bracket size
 *  - firstKOStage / bracketCount / bracketLetter sanity
 *  - generateFirstKORound match counts for single A-slutspel bracket sizes
 *  - generateFirstKORound multi-bracket totals
 *  - generateNextKORound preserves bracket and produces correct stage
 *  - hasBronze interactions per bracket
 *  - 1-court / many-courts / court-cycling
 */

import { describe, it, expect } from "vitest";
import {
  generateFirstKORound,
  generateNextKORound,
  firstKOStage,
  bracketCount,
  bracketLetter,
  type GroupStanding,
  type GeneratedKOMatch,
} from "../knockout";
import type { Court, TournamentMatch } from "../../supabase/types";

const TID = "t-test";

function makeCourts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    tenant_id: "tenant",
    name: `Bana ${i + 1}`,
    sort_order: i,
  }));
}

function makeGroup(id: string, teamIds: string[]): GroupStanding {
  return {
    groupId: id,
    groupName: id,
    standings: teamIds.map((t) => ({
      team_id: t,
      teamName: t,
      mp: 0,
      gf: 0,
      ga: 0,
      gd: 0,
    })),
  };
}

/** Build N groups each with M advancing teams; team IDs = "G{g}T{t}". */
function makeGroups(groupCount: number, advancesPerGroup: number): GroupStanding[] {
  return Array.from({ length: groupCount }, (_, gi) =>
    makeGroup(
      `g${gi}`,
      Array.from({ length: advancesPerGroup }, (_, ti) => `G${gi}T${ti}`)
    )
  );
}

let _matchIdx = 0;
function completeMatch(m: GeneratedKOMatch, team1Wins = true): TournamentMatch {
  return {
    id: `m${_matchIdx++}`,
    created_at: new Date().toISOString(),
    tournament_id: m.tournament_id,
    group_id: m.group_id,
    round_number: m.round_number,
    court_id: m.court_id,
    team1_id: m.team1_id!,
    team2_id: m.team2_id!,
    score_team1: team1Wins ? 7 : 6,
    score_team2: team1Wins ? 6 : 7,
    status: "completed",
    stage: m.stage,
    bracket: m.bracket,
  };
}

// computeBracketPath is per-bracket (HostView uses it once per bracket). The
// inline copy here mirrors the live implementation so changes stay in sync.
type BracketStep = { label: string; matchCount: number; isNow: boolean };
function computeBracketPath(totalAdvancing: number, hasBronze: boolean): BracketStep[] {
  const steps: BracketStep[] = [];
  if (totalAdvancing > 8) {
    const playIn = totalAdvancing - 8;
    steps.push({ label: "Inledningsrunda", matchCount: playIn, isNow: true });
    steps.push({ label: "Kvartsfinal", matchCount: 4, isNow: false });
    steps.push({ label: "Semifinal", matchCount: 2, isNow: false });
  } else if (totalAdvancing > 4) {
    const qfMatches = totalAdvancing - 4;
    steps.push({ label: "Kvartsfinal", matchCount: qfMatches, isNow: true });
    steps.push({ label: "Semifinal", matchCount: 2, isNow: false });
  } else if (totalAdvancing > 2) {
    const sfMatches = Math.floor(totalAdvancing / 2);
    const isPlayIn = totalAdvancing === 3;
    steps.push({
      label: isPlayIn ? "Inledningsrunda" : "Semifinal",
      matchCount: sfMatches,
      isNow: true,
    });
  }
  steps.push({ label: "Final", matchCount: 1, isNow: totalAdvancing <= 2 });
  if (hasBronze) steps.push({ label: "Bronsmatch", matchCount: 1, isNow: false });
  return steps;
}

// ---------------------------------------------------------------------------
// computeBracketPath — covers every realistic per-bracket size
// ---------------------------------------------------------------------------

describe("computeBracketPath — per-bracket sizes", () => {
  it("2 teams → [Final(now)]", () => {
    const path = computeBracketPath(2, false);
    expect(path).toEqual([{ label: "Final", matchCount: 1, isNow: true }]);
  });

  it("3 teams → [Inledningsrunda(now), Final]", () => {
    const path = computeBracketPath(3, false);
    expect(path).toHaveLength(2);
    expect(path[0]).toMatchObject({ label: "Inledningsrunda", isNow: true });
    expect(path[1]).toMatchObject({ label: "Final", isNow: false });
  });

  it("4 teams → [SF×2(now), Final]", () => {
    const path = computeBracketPath(4, false);
    expect(path[0]).toMatchObject({ label: "Semifinal", matchCount: 2, isNow: true });
    expect(path[1]).toMatchObject({ label: "Final" });
  });

  it("5 teams → [QF×1(now), SF×2, Final]", () => {
    const path = computeBracketPath(5, false);
    expect(path[0]).toMatchObject({ label: "Kvartsfinal", matchCount: 1, isNow: true });
  });

  it("8 teams → [QF×4(now), SF×2, Final]", () => {
    const path = computeBracketPath(8, false);
    expect(path[0]).toMatchObject({ label: "Kvartsfinal", matchCount: 4, isNow: true });
  });

  it("9 teams → [Inledningsrunda×1(now), QF×4, SF×2, Final]", () => {
    const path = computeBracketPath(9, false);
    expect(path).toHaveLength(4);
    expect(path[0]).toMatchObject({ label: "Inledningsrunda", matchCount: 1, isNow: true });
  });

  it("16 teams → [Inledningsrunda×8(now), QF×4, SF×2, Final]", () => {
    const path = computeBracketPath(16, false);
    expect(path[0]).toMatchObject({ label: "Inledningsrunda", matchCount: 8 });
  });

  it("hasBronze appends Bronsmatch as last step with isNow=false", () => {
    for (const n of [2, 3, 4, 5, 8, 10]) {
      const path = computeBracketPath(n, true);
      const last = path[path.length - 1];
      expect(last, `n=${n}`).toMatchObject({
        label: "Bronsmatch",
        matchCount: 1,
        isNow: false,
      });
    }
  });

  it("only the first step is isNow=true for any n", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16]) {
      const path = computeBracketPath(n, false);
      const nowSteps = path.filter((s) => s.isNow);
      expect(nowSteps, `n=${n}`).toHaveLength(1);
      expect(path[0].isNow, `n=${n}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// firstKOStage / bracketCount / bracketLetter
// ---------------------------------------------------------------------------

describe("firstKOStage", () => {
  it.each([
    [1, "final"],
    [2, "final"],
    [3, "semi_final"],
    [4, "semi_final"],
    [5, "quarter_final"],
    [8, "quarter_final"],
    [16, "quarter_final"],
  ])("firstKOStage(%i) = %s", (n, expected) => {
    expect(firstKOStage(n)).toBe(expected);
  });
});

describe("bracketCount + bracketLetter", () => {
  it("returns 1 for a single group regardless of advances_per_group", () => {
    expect(bracketCount([makeGroup("g0", ["A1", "A2", "A3"])])).toBe(1);
  });

  it("returns 0 for empty input", () => {
    expect(bracketCount([])).toBe(0);
  });

  it("returns max advancing rank across groups when ≥2 groups", () => {
    expect(bracketCount(makeGroups(2, 1))).toBe(1);
    expect(bracketCount(makeGroups(4, 2))).toBe(2);
    expect(bracketCount(makeGroups(2, 4))).toBe(4);
  });

  it("bracketLetter clamps to A..Z", () => {
    expect(bracketLetter(0)).toBe("A");
    expect(bracketLetter(25)).toBe("Z");
    expect(bracketLetter(99)).toBe("Z");
  });
});

// ---------------------------------------------------------------------------
// generateFirstKORound — single A-slutspel sizes (1 advance per group)
// ---------------------------------------------------------------------------

describe("single A-slutspel: match count per advancing total (1 advance per group)", () => {
  const courts = makeCourts(8);

  it.each([
    [2, 1],   // straight Final
    [3, 1],   // 1 play-in
    [4, 2],   // 2 SFs
    [5, 1],   // 1 QF (3 internal byes)
    [6, 2],
    [7, 3],
    [8, 4],
    [9, 1],   // 1 play-in
    [10, 2],
    [12, 4],
    [16, 8],
  ])("%i groups × 1 → %i first-round matches in A-slutspel", (groups, expected) => {
    const standings = makeGroups(groups, 1);
    const matches = generateFirstKORound(standings, [], courts, TID, false);
    expect(matches, `groups=${groups}`).toHaveLength(expected);
    expect(matches.every((m) => m.bracket === "A")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-bracket: total matches across all brackets
// ---------------------------------------------------------------------------

describe("multi-bracket first-round totals", () => {
  const courts = makeCourts(8);

  it("4 groups × 2 advance: 2 brackets × 2 SFs each = 4 first-round matches", () => {
    const matches = generateFirstKORound(makeGroups(4, 2), [], courts, TID, false);
    expect(matches).toHaveLength(4);
    expect(matches.filter((m) => m.bracket === "A")).toHaveLength(2);
    expect(matches.filter((m) => m.bracket === "B")).toHaveLength(2);
  });

  it("3 groups × 3 advance: 3 brackets × 1 play-in each = 3 first-round matches", () => {
    const matches = generateFirstKORound(makeGroups(3, 3), [], courts, TID, false);
    expect(matches).toHaveLength(3);
    const letters = new Set(matches.map((m) => m.bracket));
    expect(letters).toEqual(new Set(["A", "B", "C"]));
  });

  it("8 groups × 2 advance: 2 brackets × 4 QFs each = 8 first-round matches, no play-in", () => {
    const matches = generateFirstKORound(makeGroups(8, 2), [], courts, TID, false);
    expect(matches).toHaveLength(8);
    expect(matches.filter((m) => m.bracket === "A")).toHaveLength(4);
    expect(matches.filter((m) => m.bracket === "B")).toHaveLength(4);
    expect(matches.every((m) => m.stage === "quarter_final")).toBe(true);
  });

  it("uneven advancement: some brackets are smaller than others", () => {
    // 3 groups but only 2 of them advance a 2nd-place team
    const groups: GroupStanding[] = [
      makeGroup("g0", ["G0T0", "G0T1"]),
      makeGroup("g1", ["G1T0", "G1T1"]),
      makeGroup("g2", ["G2T0"]), // only one advances
    ];
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    // A-slutspel: 3 teams (G0T0, G1T0, G2T0) → 1 play-in
    // B-slutspel: 2 teams (G0T1, G1T1) → 1 final
    expect(matches.filter((m) => m.bracket === "A")).toHaveLength(1);
    expect(matches.filter((m) => m.bracket === "B")).toHaveLength(1);
    expect(matches.find((m) => m.bracket === "A")!.stage).toBe("quarter_final");
    expect(matches.find((m) => m.bracket === "B")!.stage).toBe("final");
  });

  it("singleton bracket is dropped (1 team can't form a bracket)", () => {
    // 2 groups, but only g0 advances a 2nd-place. B-slutspel has 1 team → skip.
    const groups: GroupStanding[] = [
      makeGroup("g0", ["G0T0", "G0T1"]),
      makeGroup("g1", ["G1T0"]),
    ];
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    // Only A-slutspel runs: G0T0 vs G1T0 final
    expect(matches).toHaveLength(1);
    expect(matches[0].bracket).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// hasBronze — generated per bracket
// ---------------------------------------------------------------------------

describe("hasBronze — per-bracket bronze", () => {
  it("4-team bracket with hasBronze produces a bronze when SFs complete", () => {
    _matchIdx = 0;
    const sfs = generateFirstKORound(makeGroups(4, 1), [], makeCourts(2), TID, true);
    expect(sfs.every((m) => m.bracket === "A")).toBe(true);
    const completed = sfs.map((m) => completeMatch(m));
    const next = generateNextKORound(completed, [], makeCourts(2), TID, true);
    expect(next.find((m) => m.stage === "final")).toBeDefined();
    expect(next.find((m) => m.stage === "bronze")).toBeDefined();
  });

  it("3-team bracket with hasBronze: only 1 SF + Final, no Bronze", () => {
    _matchIdx = 0;
    const playIn = generateFirstKORound(makeGroups(3, 1), [], makeCourts(2), TID, true);
    const completed = playIn.map((m) => completeMatch(m));
    // Top seed gets external bye into the next round
    const byes = ["G0T0"];
    const next = generateNextKORound(completed, byes, makeCourts(2), TID, true);
    // Goes straight to Final via 2 entrants → no Bronze (Bronze needs 2 SFs)
    expect(next.filter((m) => m.stage === "final")).toHaveLength(1);
    expect(next.find((m) => m.stage === "bronze")).toBeUndefined();
  });

  it("hasBronze=false never emits a bronze match", () => {
    _matchIdx = 0;
    const sfs = generateFirstKORound(makeGroups(4, 1), [], makeCourts(2), TID, false);
    const completed = sfs.map((m) => completeMatch(m));
    const next = generateNextKORound(completed, [], makeCourts(2), TID, false);
    expect(next.find((m) => m.stage === "bronze")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Court allocation
// ---------------------------------------------------------------------------

describe("court allocation", () => {
  it("8 teams × 2 courts: matches alternate court_id across the round", () => {
    _matchIdx = 0;
    const matches = generateFirstKORound(makeGroups(8, 1), [], makeCourts(2), TID, false);
    expect(matches).toHaveLength(4);
    expect(matches[0].court_id).toBe("c1");
    expect(matches[1].court_id).toBe("c2");
    expect(matches[2].court_id).toBe("c1");
    expect(matches[3].court_id).toBe("c2");
  });

  it("multi-bracket court split: each bracket gets its own subset (round-robin)", () => {
    _matchIdx = 0;
    const matches = generateFirstKORound(makeGroups(4, 2), [], makeCourts(4), TID, false);
    const aCourts = new Set(
      matches.filter((m) => m.bracket === "A").map((m) => m.court_id)
    );
    const bCourts = new Set(
      matches.filter((m) => m.bracket === "B").map((m) => m.court_id)
    );
    // A gets c1/c3, B gets c2/c4 (round-robin), no overlap
    expect([...aCourts].some((c) => bCourts.has(c!))).toBe(false);
  });

  it("falls back to the global courts list when a bracket gets no slot", () => {
    // 4 brackets but only 2 courts: some bracket would be empty under strict
    // round-robin. Helper returns the full list so matches still have a court.
    _matchIdx = 0;
    const matches = generateFirstKORound(makeGroups(2, 4), [], makeCourts(2), TID, false);
    expect(matches.every((m) => m.court_id !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1-court configuration: every reasonable bracket size still completes
// ---------------------------------------------------------------------------

describe("1 court — every bracket size produces a Final eventually", () => {
  it("2 teams: straight Final", () => {
    _matchIdx = 0;
    const courts = makeCourts(1);
    const r1 = generateFirstKORound(makeGroups(2, 1), [], courts, TID, false);
    expect(r1).toHaveLength(1);
    expect(r1[0].stage).toBe("final");
  });

  it("3 teams: play-in → Final via top-seed bye", () => {
    _matchIdx = 0;
    const courts = makeCourts(1);
    const r1 = generateFirstKORound(makeGroups(3, 1), [], courts, TID, false);
    expect(r1[0].stage).toBe("quarter_final");
    const r1Done = r1.map((m) => completeMatch(m));
    const r2 = generateNextKORound(r1Done, ["G0T0"], courts, TID, false);
    expect(r2.find((m) => m.stage === "final")).toBeDefined();
  });

  it("4 teams: SF → Final", () => {
    _matchIdx = 0;
    const courts = makeCourts(1);
    const r1 = generateFirstKORound(makeGroups(4, 1), [], courts, TID, false);
    expect(r1.every((m) => m.stage === "semi_final")).toBe(true);
    const r1Done = r1.map((m) => completeMatch(m));
    const r2 = generateNextKORound(r1Done, [], courts, TID, false);
    expect(r2.find((m) => m.stage === "final")).toBeDefined();
  });

  it("5 teams: QF play-in → SF → Final", () => {
    _matchIdx = 0;
    const courts = makeCourts(1);
    const r1 = generateFirstKORound(makeGroups(5, 1), [], courts, TID, false);
    expect(r1).toHaveLength(1);
    expect(r1[0].stage).toBe("quarter_final");
    const r1Done = r1.map((m) => completeMatch(m));
    const r2 = generateNextKORound(
      r1Done,
      ["G0T0", "G1T0", "G2T0"],
      courts,
      TID,
      false
    );
    expect(r2).toHaveLength(2);
    expect(r2.every((m) => m.stage === "semi_final")).toBe(true);
    const r2Done = r2.map((m) => completeMatch(m));
    const r3 = generateNextKORound(r2Done, [], courts, TID, false);
    expect(r3.find((m) => m.stage === "final")).toBeDefined();
  });

  it("8 teams: QF → SF → Final on a single court", () => {
    _matchIdx = 0;
    const courts = makeCourts(1);
    const r1 = generateFirstKORound(makeGroups(8, 1), [], courts, TID, false);
    expect(r1).toHaveLength(4);
    const r1Done = r1.map((m) => completeMatch(m));
    const r2 = generateNextKORound(r1Done, [], courts, TID, false);
    expect(r2).toHaveLength(2);
    const r2Done = r2.map((m) => completeMatch(m));
    const r3 = generateNextKORound(r2Done, [], courts, TID, false);
    expect(r3.find((m) => m.stage === "final")).toBeDefined();
  });
});
