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

function standing(
  team_id: string,
  gf: number = 0,
  gd: number = 0
): GroupStanding["standings"][number] {
  return {
    team_id,
    teamName: team_id,
    mp: 0,
    gf,
    ga: 0,
    gd,
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

  it("4 groups × 2 → QF pairings A1-D2, A2-D1, B1-C2, B2-C1", () => {
    // Spec: with 4 groups (A,B,C,D) and 2 advancing each, the 8-team bracket
    // must follow standard tennis seeding so top seeds can only meet later:
    //   pair 0: A1 v D2   (seed 1 v seed 8)
    //   pair 1: D1 v A2   (seed 4 v seed 5)
    //   pair 2: B1 v C2   (seed 2 v seed 7)
    //   pair 3: C1 v B2   (seed 3 v seed 6)
    const groups: GroupStanding[] = [
      group("gA", "Grupp A", ["A1", "A2"]),
      group("gB", "Grupp B", ["B1", "B2"]),
      group("gC", "Grupp C", ["C1", "C2"]),
      group("gD", "Grupp D", ["D1", "D2"]),
    ];
    const qualified: QualifiedTeam[] = [
      qual("A1", "gA", 0), qual("A2", "gA", 1),
      qual("B1", "gB", 0), qual("B2", "gB", 1),
      qual("C1", "gC", 0), qual("C2", "gC", 1),
      qual("D1", "gD", 0), qual("D2", "gD", 1),
    ];
    const matches = generateAutoFirstRound(groups, qualified, [], TID);
    const pairs = matches.map((m) => [m.team1_id, m.team2_id].sort());
    expect(pairs).toEqual([
      ["A1", "D2"],
      ["A2", "D1"],
      ["B1", "C2"],
      ["B2", "C1"],
    ]);
  });

  it("4 groups × 4 → same pairing pattern in A- and B-slutspel", () => {
    // Top-half (rank 0/1) populates A; bottom-half (rank 2/3) populates B.
    // Both brackets must follow the standard seed-vs-seed pattern.
    const groups: GroupStanding[] = [
      group("gA", "Grupp A", ["A1", "A2", "A3", "A4"]),
      group("gB", "Grupp B", ["B1", "B2", "B3", "B4"]),
      group("gC", "Grupp C", ["C1", "C2", "C3", "C4"]),
      group("gD", "Grupp D", ["D1", "D2", "D3", "D4"]),
    ];
    const qualified: QualifiedTeam[] = [];
    for (const g of ["A", "B", "C", "D"]) {
      for (let r = 0; r < 4; r++) qualified.push(qual(`${g}${r + 1}`, `g${g}`, r));
    }
    const matches = generateAutoFirstRound(groups, qualified, [], TID);
    const a = matches.filter((m) => m.bracket === "A").map((m) => [m.team1_id, m.team2_id].sort());
    const b = matches.filter((m) => m.bracket === "B").map((m) => [m.team1_id, m.team2_id].sort());
    expect(a).toEqual([
      ["A1", "D2"],
      ["A2", "D1"],
      ["B1", "C2"],
      ["B2", "C1"],
    ]);
    expect(b).toEqual([
      ["A3", "D4"],
      ["A4", "D3"],
      ["B3", "C4"],
      ["B4", "C3"],
    ]);
  });

  it("4 groups × 4 → pairings ignore GF/GD (group label drives seed slot)", () => {
    // Scenario from the real-world tournament: Group 3 winner has the best GF
    // but must still occupy seed slot 3 (= C1), not slot 1. Group 1 winner
    // owns slot 1 regardless of GF.
    const groups: GroupStanding[] = [
      {
        groupId: "gA", groupName: "Grupp 1",
        standings: [standing("A1", 20, 8), standing("A2", 17, 8), standing("A3", 15, 0), standing("A4", 11, -7)],
      },
      {
        groupId: "gB", groupName: "Grupp 2",
        standings: [standing("B1", 18, 7), standing("B2", 18, 5), standing("B3", 17, 6), standing("B4", 10, -7)],
      },
      {
        groupId: "gC", groupName: "Grupp 3",
        standings: [standing("C1", 20, 12), standing("C2", 19, 8), standing("C3", 15, -2), standing("C4", 10, -9)],
      },
      {
        groupId: "gD", groupName: "Grupp 4",
        standings: [standing("D1", 19, 9), standing("D2", 18, 3), standing("D3", 16, 3), standing("D4", 15, -3)],
      },
    ];
    const qualified: QualifiedTeam[] = [];
    for (const g of ["A", "B", "C", "D"]) {
      for (let r = 0; r < 4; r++) qualified.push(qual(`${g}${r + 1}`, `g${g}`, r));
    }
    const matches = generateAutoFirstRound(groups, qualified, [], TID);
    const a = matches.filter((m) => m.bracket === "A").map((m) => [m.team1_id, m.team2_id].sort());
    const b = matches.filter((m) => m.bracket === "B").map((m) => [m.team1_id, m.team2_id].sort());
    // Even though C1 has higher GF/GD than A1, group label wins — A1 stays seed 1.
    expect(a).toEqual([
      ["A1", "D2"],
      ["A2", "D1"],
      ["B1", "C2"],
      ["B2", "C1"],
    ]);
    expect(b).toEqual([
      ["A3", "D4"],
      ["A4", "D3"],
      ["B3", "C4"],
      ["B4", "C3"],
    ]);
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
