/**
 * Playoff / knockout bracket tests — multi-bracket model.
 *
 * Each rank that advances from the group stage forms its own bracket:
 *   1st-place finishers → A-slutspel
 *   2nd-place finishers → B-slutspel
 *   3rd-place finishers → C-slutspel
 *   …
 *
 * Single-group tournaments fall back to a single A-slutspel containing all
 * advancing teams (legacy single-bracket behavior).
 *
 * Run with:  npx jest src/lib/algorithms/__tests__/knockout.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  generateFirstKORound,
  generateNextKORound,
  firstKOStage,
  byeCount,
  bracketCount,
  bracketLetter,
  type GroupStanding,
  type GeneratedKOMatch,
} from "../knockout";
import type { Court, TournamentMatch } from "../../supabase/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TID = "t-test";

function makeCourts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `court-${i + 1}`,
    tenant_id: "tenant-test",
    name: `Court ${i + 1}`,
    sort_order: i,
  }));
}

function makeStanding(teamId: string): import("../../standings").TeamStanding {
  return { team_id: teamId, teamName: teamId, mp: 0, gf: 0, ga: 0, gd: 0 };
}

function makeGroup(
  id: string,
  name: string,
  teamIds: string[]
): GroupStanding {
  return {
    groupId: id,
    groupName: name,
    standings: teamIds.map(makeStanding),
  };
}

function completeMatch(m: GeneratedKOMatch, idx: number): TournamentMatch {
  return {
    id: `match-${idx}`,
    created_at: new Date().toISOString(),
    tournament_id: m.tournament_id,
    group_id: m.group_id,
    round_number: m.round_number,
    court_id: m.court_id,
    team1_id: m.team1_id!,
    team2_id: m.team2_id!,
    score_team1: 7,
    score_team2: 6,
    status: "completed",
    stage: m.stage,
    bracket: m.bracket,
  };
}

// ---------------------------------------------------------------------------
// Bracket count + letter
// ---------------------------------------------------------------------------

describe("bracketCount + bracketLetter", () => {
  it("returns 1 for a single group", () => {
    const groups = [makeGroup("g-a", "A", ["A1", "A2", "A3"])];
    expect(bracketCount(groups)).toBe(1);
  });

  it("returns advances_per_group when ≥2 groups", () => {
    const g = (id: string, teams: string[]) => makeGroup(id, id, teams);
    expect(bracketCount([g("a", ["A1"]), g("b", ["B1"])])).toBe(1);
    expect(bracketCount([g("a", ["A1", "A2"]), g("b", ["B1", "B2"])])).toBe(2);
    expect(
      bracketCount([
        g("a", ["A1", "A2", "A3"]),
        g("b", ["B1", "B2", "B3"]),
        g("c", ["C1", "C2", "C3"]),
      ])
    ).toBe(3);
  });

  it("bracketLetter maps 0..3 to A..D", () => {
    expect(bracketLetter(0)).toBe("A");
    expect(bracketLetter(1)).toBe("B");
    expect(bracketLetter(2)).toBe("C");
    expect(bracketLetter(3)).toBe("D");
  });
});

// ---------------------------------------------------------------------------
// Scenario 1 — 2 groups × 1 advance → single A-slutspel Final
// ---------------------------------------------------------------------------
describe("2 groups × 1 advance → A-slutspel Final", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1"]),
    makeGroup("g-b", "Grupp B", ["B1"]),
  ];
  const courts = makeCourts(1);

  it("generates a single Final in bracket A", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].stage).toBe("final");
    expect(matches[0].bracket).toBe("A");
    expect(matches[0].team1_id).toBe("A1");
    expect(matches[0].team2_id).toBe("B1");
  });

  it("no next round after the Final", () => {
    const final = generateFirstKORound(groups, [], courts, TID, false);
    const completed = final.map((m, i) => completeMatch(m, i));
    expect(generateNextKORound(completed, [], courts, TID, false)).toHaveLength(0);
  });

  it("byeCount is always 0", () => {
    expect(byeCount(groups)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — 2 groups × 2 advance → A-slutspel Final + B-slutspel Final
// ---------------------------------------------------------------------------
describe("2 groups × 2 advance → A-slutspel + B-slutspel each play a Final", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1", "A2"]),
    makeGroup("g-b", "Grupp B", ["B1", "B2"]),
  ];
  const courts = makeCourts(2);

  it("generates 2 Finals (one per bracket), no SF/QF anywhere", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.stage === "final")).toBe(true);
  });

  it("A-slutspel pairs the rank-0 teams (A1 vs B1)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const a = matches.find((m) => m.bracket === "A")!;
    expect(a).toBeDefined();
    expect(a.team1_id).toBe("A1");
    expect(a.team2_id).toBe("B1");
  });

  it("B-slutspel pairs the rank-1 teams (A2 vs B2)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const b = matches.find((m) => m.bracket === "B")!;
    expect(b).toBeDefined();
    expect(b.team1_id).toBe("A2");
    expect(b.team2_id).toBe("B2");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — 3 groups × 1 advance → A-slutspel only, 3 teams → SF with 1 bye
// ---------------------------------------------------------------------------
describe("3 groups × 1 advance → A-slutspel SF with 1 internal bye", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1"]),
    makeGroup("g-b", "Grupp B", ["B1"]),
    makeGroup("g-c", "Grupp C", ["C1"]),
  ];
  const courts = makeCourts(2);

  it("generates 1 play-in match in bracket A at quarter_final stage", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].stage).toBe("quarter_final");
    expect(matches[0].bracket).toBe("A");
  });

  it("play-in is B1 vs C1 (top seed A1 gets the bye)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches[0].team1_id).toBe("B1");
    expect(matches[0].team2_id).toBe("C1");
  });

  it("after play-in, the Final is A1 (bye) vs B1 (winner) and stays in bracket A", () => {
    const playIn = generateFirstKORound(groups, [], courts, TID, false);
    const completed = playIn.map((m, i) => completeMatch(m, i));
    const next = generateNextKORound(completed, ["A1"], courts, TID, false);
    expect(next).toHaveLength(1);
    expect(next[0].stage).toBe("final");
    expect(next[0].bracket).toBe("A");
    expect(next[0].team1_id).toBe("A1");
    expect(next[0].team2_id).toBe("B1");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — 4 groups × 2 advance → A-slutspel + B-slutspel, each 4-team SF
// ---------------------------------------------------------------------------
describe("4 groups × 2 advance → two 4-team brackets", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1", "A2"]),
    makeGroup("g-b", "Grupp B", ["B1", "B2"]),
    makeGroup("g-c", "Grupp C", ["C1", "C2"]),
    makeGroup("g-d", "Grupp D", ["D1", "D2"]),
  ];
  const courts = makeCourts(4);

  it("generates 4 SFs total: 2 in bracket A, 2 in bracket B", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, true);
    expect(matches).toHaveLength(4);
    expect(matches.every((m) => m.stage === "semi_final")).toBe(true);
    expect(matches.filter((m) => m.bracket === "A")).toHaveLength(2);
    expect(matches.filter((m) => m.bracket === "B")).toHaveLength(2);
  });

  it("A-slutspel teams are A1 B1 C1 D1 only", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const a = matches.filter((m) => m.bracket === "A");
    const teams = new Set(a.flatMap((m) => [m.team1_id, m.team2_id]));
    expect(teams).toEqual(new Set(["A1", "B1", "C1", "D1"]));
  });

  it("B-slutspel teams are A2 B2 C2 D2 only", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const b = matches.filter((m) => m.bracket === "B");
    const teams = new Set(b.flatMap((m) => [m.team1_id, m.team2_id]));
    expect(teams).toEqual(new Set(["A2", "B2", "C2", "D2"]));
  });

  it("each bracket runs on its own subset of courts (round-robin split)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const aCourts = matches.filter((m) => m.bracket === "A").map((m) => m.court_id);
    const bCourts = matches.filter((m) => m.bracket === "B").map((m) => m.court_id);
    // No overlap between bracket A and B court IDs
    const overlap = aCourts.filter((c) => bCourts.includes(c));
    expect(overlap).toHaveLength(0);
  });

  it("next round after both A-slutspel SFs gives a Final + Bronze in bracket A", () => {
    const sfs = generateFirstKORound(groups, [], courts, TID, true);
    const aSfs = sfs.filter((m) => m.bracket === "A");
    const completed = aSfs.map((m, i) => completeMatch(m, i));
    const next = generateNextKORound(completed, [], courts, TID, true);
    expect(next.find((m) => m.stage === "final")?.bracket).toBe("A");
    expect(next.find((m) => m.stage === "bronze")?.bracket).toBe("A");
  });

  it("bronze is generated PER bracket when has_bronze=true", () => {
    const sfs = generateFirstKORound(groups, [], courts, TID, true);
    const aCompleted = sfs
      .filter((m) => m.bracket === "A")
      .map((m, i) => completeMatch(m, i));
    const bCompleted = sfs
      .filter((m) => m.bracket === "B")
      .map((m, i) => completeMatch(m, i + 100));
    const aNext = generateNextKORound(aCompleted, [], courts, TID, true);
    const bNext = generateNextKORound(bCompleted, [], courts, TID, true);
    expect(aNext.some((m) => m.stage === "bronze" && m.bracket === "A")).toBe(true);
    expect(bNext.some((m) => m.stage === "bronze" && m.bracket === "B")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — 4 groups × 1 advance → single A-slutspel SF (4 teams)
// ---------------------------------------------------------------------------
describe("4 groups × 1 advance → A-slutspel SF (4 teams)", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1"]),
    makeGroup("g-b", "Grupp B", ["B1"]),
    makeGroup("g-c", "Grupp C", ["C1"]),
    makeGroup("g-d", "Grupp D", ["D1"]),
  ];
  const courts = makeCourts(2);

  it("generates 2 semi-final matches in bracket A only", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.stage === "semi_final")).toBe(true);
    expect(matches.every((m) => m.bracket === "A")).toBe(true);
  });

  it("classic seeding: SF1 = A1 vs D1, SF2 = B1 vs C1", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches[0].team1_id).toBe("A1");
    expect(matches[0].team2_id).toBe("D1");
    expect(matches[1].team1_id).toBe("B1");
    expect(matches[1].team2_id).toBe("C1");
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — 1 group × 2 advance → single-group fallback (A-slutspel Final)
// ---------------------------------------------------------------------------
describe("1 group × 2 advance → single-group fallback", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1", "A2", "A3", "A4"]),
  ];
  // Only 2 advance
  const advancing = groups.map((g) => ({ ...g, standings: g.standings.slice(0, 2) }));
  const courts = makeCourts(1);

  it("generates a single Final A1 vs A2 in bracket A", () => {
    const matches = generateFirstKORound(advancing, [], courts, TID, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].stage).toBe("final");
    expect(matches[0].bracket).toBe("A");
    expect(matches[0].team1_id).toBe("A1");
    expect(matches[0].team2_id).toBe("A2");
  });
});

// ---------------------------------------------------------------------------
// 3 groups × 2 advance → A-slutspel + B-slutspel, each with 3-team play-in
// ---------------------------------------------------------------------------
describe("3 groups × 2 advance → 2 brackets, each 3-team SF with bye", () => {
  const groups: GroupStanding[] = [
    makeGroup("g-a", "Grupp A", ["A1", "A2"]),
    makeGroup("g-b", "Grupp B", ["B1", "B2"]),
    makeGroup("g-c", "Grupp C", ["C1", "C2"]),
  ];
  const courts = makeCourts(2);

  it("each bracket has exactly 1 play-in match (top seed gets bye)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches.filter((m) => m.bracket === "A")).toHaveLength(1);
    expect(matches.filter((m) => m.bracket === "B")).toHaveLength(1);
  });

  it("A-slutspel play-in is B1 vs C1 (A1 byes)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const a = matches.find((m) => m.bracket === "A")!;
    expect(a.team1_id).toBe("B1");
    expect(a.team2_id).toBe("C1");
  });

  it("B-slutspel play-in is B2 vs C2 (A2 byes)", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    const b = matches.find((m) => m.bracket === "B")!;
    expect(b.team1_id).toBe("B2");
    expect(b.team2_id).toBe("C2");
  });
});

// ---------------------------------------------------------------------------
// 5 groups × 1 advance → A-slutspel only, 5 teams → 1 QF + SF + Final
// ---------------------------------------------------------------------------
describe("5 groups × 1 advance → A-slutspel QF play-in", () => {
  const groups: GroupStanding[] = Array.from({ length: 5 }, (_, i) =>
    makeGroup(`g-${i}`, `Grupp ${i}`, [`G${i}T0`])
  );
  const courts = makeCourts(2);

  it("first round has exactly 1 QF play-in match in bracket A", () => {
    const matches = generateFirstKORound(groups, [], courts, TID, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].stage).toBe("quarter_final");
    expect(matches[0].bracket).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// generateNextKORound — bracket inheritance
// ---------------------------------------------------------------------------
describe("generateNextKORound preserves bracket from completed matches", () => {
  it("matches inherit the bracket of the first completed match", () => {
    const fakeCompleted: TournamentMatch[] = [
      {
        id: "x1",
        created_at: new Date().toISOString(),
        tournament_id: TID,
        group_id: null,
        round_number: 1,
        court_id: "c1",
        team1_id: "T1",
        team2_id: "T2",
        score_team1: 7,
        score_team2: 6,
        status: "completed",
        stage: "semi_final",
        bracket: "B",
      },
      {
        id: "x2",
        created_at: new Date().toISOString(),
        tournament_id: TID,
        group_id: null,
        round_number: 1,
        court_id: "c2",
        team1_id: "T3",
        team2_id: "T4",
        score_team1: 7,
        score_team2: 6,
        status: "completed",
        stage: "semi_final",
        bracket: "B",
      },
    ];
    const next = generateNextKORound(fakeCompleted, [], makeCourts(2), TID, false);
    expect(next).toHaveLength(1);
    expect(next[0].stage).toBe("final");
    expect(next[0].bracket).toBe("B");
  });
});

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
