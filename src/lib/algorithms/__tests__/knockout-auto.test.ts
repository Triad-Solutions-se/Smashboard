/**
 * Auto-bracket tests: the "8-team QF when possible, A/B/C-slutspel when
 * totalAdvancing is a multiple of 8 ≥ 16" rule that replaces the host-picked
 * single/split toggle.
 *
 * Run with:  npx vitest src/lib/algorithms/__tests__/knockout-auto.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  autoBracketSizes,
  autoBracketSeedOrders,
  generateAutoFirstRound,
  bracketLabelAuto,
  type GroupStanding,
  type QualifiedTeam,
} from "../knockout";
import type { Court } from "../../supabase/types";

const TID = "t-auto";

function makeCourts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `court-${i + 1}`,
    tenant_id: "tenant-test",
    name: `Court ${i + 1}`,
    sort_order: i,
  }));
}

function standing(team_id: string): GroupStanding["standings"][number] {
  return {
    team_id,
    teamName: team_id,
    played: 0,
    wins: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
  };
}

function group(id: string, name: string, teamIds: string[]): GroupStanding {
  return {
    groupId: id,
    groupName: name,
    standings: teamIds.map((t) => standing(t)),
  };
}

function qual(
  team_id: string,
  groupId: string,
  rank: number
): QualifiedTeam {
  return { team_id, groupId, rank, manualSeed: null, gf: 0, gd: 0, ga: 0 };
}

describe("autoBracketSizes", () => {
  it("returns [] for under 2 teams", () => {
    expect(autoBracketSizes(0)).toEqual([]);
    expect(autoBracketSizes(1)).toEqual([]);
  });
  it("returns a single bracket for 2–15 teams", () => {
    expect(autoBracketSizes(2)).toEqual([2]);
    expect(autoBracketSizes(4)).toEqual([4]);
    expect(autoBracketSizes(6)).toEqual([6]);
    expect(autoBracketSizes(8)).toEqual([8]);
    expect(autoBracketSizes(10)).toEqual([10]);
    expect(autoBracketSizes(12)).toEqual([12]);
    expect(autoBracketSizes(15)).toEqual([15]);
  });
  it("splits into 8-team chunks for multiples of 8 ≥ 16", () => {
    expect(autoBracketSizes(16)).toEqual([8, 8]);
    expect(autoBracketSizes(24)).toEqual([8, 8, 8]);
    expect(autoBracketSizes(32)).toEqual([8, 8, 8, 8]);
  });
  it("keeps a single bracket for non-multiples ≥ 16", () => {
    expect(autoBracketSizes(17)).toEqual([17]);
    expect(autoBracketSizes(20)).toEqual([20]);
    expect(autoBracketSizes(23)).toEqual([23]);
  });
});

describe("bracketLabelAuto", () => {
  it("drops the letter when there's only one bracket", () => {
    expect(bracketLabelAuto("A", false)).toBe("Slutspel");
  });
  it("keeps the letter when multiple brackets exist", () => {
    expect(bracketLabelAuto("A", true)).toBe("A-slutspel");
    expect(bracketLabelAuto("C", true)).toBe("C-slutspel");
  });
});

describe("generateAutoFirstRound", () => {
  it("delegates to the single-bracket path when totalAdvancing < 16", () => {
    // 4 groups × 2 advances = 8 → one 8-team QF bracket
    const groups: GroupStanding[] = [
      group("g1", "Grupp 1", ["t1", "t5"]),
      group("g2", "Grupp 2", ["t2", "t6"]),
      group("g3", "Grupp 3", ["t3", "t7"]),
      group("g4", "Grupp 4", ["t4", "t8"]),
    ];
    const qualified: QualifiedTeam[] = [
      qual("t1", "g1", 0), qual("t5", "g1", 1),
      qual("t2", "g2", 0), qual("t6", "g2", 1),
      qual("t3", "g3", 0), qual("t7", "g3", 1),
      qual("t4", "g4", 0), qual("t8", "g4", 1),
    ];
    const matches = generateAutoFirstRound(groups, qualified, makeCourts(4), TID);
    expect(matches.length).toBe(4);
    expect(matches.every((m) => m.stage === "quarter_final")).toBe(true);
    expect(matches.every((m) => m.bracket === "A")).toBe(true);
  });

  it("splits 16 advancing teams into A/B-slutspel QF brackets", () => {
    // 8 groups × 2 advances = 16 → A-slutspel and B-slutspel, each QF
    const groups: GroupStanding[] = Array.from({ length: 8 }, (_, i) =>
      group(`g${i + 1}`, `Grupp ${i + 1}`, [`t${i + 1}r1`, `t${i + 1}r2`])
    );
    const qualified: QualifiedTeam[] = [];
    for (let i = 0; i < 8; i++) {
      qualified.push(qual(`t${i + 1}r1`, `g${i + 1}`, 0));
      qualified.push(qual(`t${i + 1}r2`, `g${i + 1}`, 1));
    }
    const matches = generateAutoFirstRound(groups, qualified, makeCourts(8), TID);
    expect(matches.length).toBe(8); // 2 brackets × 4 QF matches
    const brackets = new Set(matches.map((m) => m.bracket));
    expect([...brackets].sort()).toEqual(["A", "B"]);
    expect(matches.every((m) => m.stage === "quarter_final")).toBe(true);
  });

  it("each bracket in a 16-team split contains exactly 8 teams (4 QF matches)", () => {
    const groups: GroupStanding[] = Array.from({ length: 4 }, (_, i) =>
      group(`g${i + 1}`, `Grupp ${i + 1}`, [
        `t${i + 1}r1`,
        `t${i + 1}r2`,
        `t${i + 1}r3`,
        `t${i + 1}r4`,
      ])
    );
    const qualified: QualifiedTeam[] = [];
    for (let i = 0; i < 4; i++) {
      for (let r = 0; r < 4; r++) {
        qualified.push(qual(`t${i + 1}r${r + 1}`, `g${i + 1}`, r));
      }
    }
    const matches = generateAutoFirstRound(groups, qualified, makeCourts(8), TID);
    const aBracket = matches.filter((m) => m.bracket === "A");
    const bBracket = matches.filter((m) => m.bracket === "B");
    expect(aBracket.length).toBe(4);
    expect(bBracket.length).toBe(4);
    // No team plays in both brackets
    const teamsA = new Set(aBracket.flatMap((m) => [m.team1_id, m.team2_id]));
    const teamsB = new Set(bBracket.flatMap((m) => [m.team1_id, m.team2_id]));
    for (const id of teamsA) expect(teamsB.has(id)).toBe(false);
    expect(teamsA.size).toBe(8);
    expect(teamsB.size).toBe(8);
  });

  it("splits 24 advancing teams into A/B/C-slutspel QF brackets", () => {
    const groups: GroupStanding[] = Array.from({ length: 8 }, (_, i) =>
      group(`g${i + 1}`, `Grupp ${i + 1}`, [
        `t${i + 1}r1`,
        `t${i + 1}r2`,
        `t${i + 1}r3`,
      ])
    );
    const qualified: QualifiedTeam[] = [];
    for (let i = 0; i < 8; i++) {
      for (let r = 0; r < 3; r++) {
        qualified.push(qual(`t${i + 1}r${r + 1}`, `g${i + 1}`, r));
      }
    }
    const matches = generateAutoFirstRound(groups, qualified, makeCourts(6), TID);
    expect(matches.length).toBe(12); // 3 brackets × 4 QF matches
    const brackets = new Set(matches.map((m) => m.bracket));
    expect([...brackets].sort()).toEqual(["A", "B", "C"]);
  });
});

describe("autoBracketSeedOrders", () => {
  it("returns a single A bracket with rank-major order for ≤8 advancing", () => {
    const groups: GroupStanding[] = [
      group("g1", "Grupp 1", ["t1", "t5"]),
      group("g2", "Grupp 2", ["t2", "t6"]),
      group("g3", "Grupp 3", ["t3", "t7"]),
      group("g4", "Grupp 4", ["t4", "t8"]),
    ];
    const qualified: QualifiedTeam[] = [
      qual("t1", "g1", 0), qual("t5", "g1", 1),
      qual("t2", "g2", 0), qual("t6", "g2", 1),
      qual("t3", "g3", 0), qual("t7", "g3", 1),
      qual("t4", "g4", 0), qual("t8", "g4", 1),
    ];
    const orders = autoBracketSeedOrders(groups, qualified);
    expect(orders.size).toBe(1);
    // Rank-major: all R1 teams first (group-order), then R2.
    expect(orders.get("A")).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
  });

  it("splits 16 advancing teams into two 8-team brackets by overall seed", () => {
    // All R1 teams are stronger than all R2 teams (rank 0 vs 1 sorts first).
    const groups: GroupStanding[] = Array.from({ length: 8 }, (_, i) =>
      group(`g${i + 1}`, `Grupp ${i + 1}`, [`t${i + 1}r1`, `t${i + 1}r2`])
    );
    const qualified: QualifiedTeam[] = [];
    for (let i = 0; i < 8; i++) {
      qualified.push(qual(`t${i + 1}r1`, `g${i + 1}`, 0));
      qualified.push(qual(`t${i + 1}r2`, `g${i + 1}`, 1));
    }
    const orders = autoBracketSeedOrders(groups, qualified);
    expect(orders.size).toBe(2);
    const a = orders.get("A")!;
    const b = orders.get("B")!;
    expect(a.length).toBe(8);
    expect(b.length).toBe(8);
    // A contains the top-8 seeds (all rank-0 teams).
    for (const id of a) expect(id.endsWith("r1")).toBe(true);
    // B contains seeds 9–16 (all rank-1 teams).
    for (const id of b) expect(id.endsWith("r2")).toBe(true);
  });
});
