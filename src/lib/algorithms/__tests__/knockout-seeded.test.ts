/**
 * Seeded (cross-group) bracket tests.
 *
 * All advancing teams form a single seeded bracket using a standard tennis-draw
 * seed→slot mapping. Same-group teams are placed in opposite halves so they
 * can only meet later in the bracket. Manual seeds override the auto-rank
 * tiebreaker order.
 *
 * Run with:  npx vitest src/lib/algorithms/__tests__/knockout-seeded.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  generateSeededFirstRound,
  computeSeedOrder,
  computeSeededByePairIndices,
  standardSeedSlots,
  buildBracketSlots,
  type QualifiedTeam,
} from "../knockout";
import type { Court } from "../../supabase/types";

const TID = "t-test";

function makeCourts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `court-${i + 1}`,
    tenant_id: "tenant-test",
    name: `Court ${i + 1}`,
    sort_order: i,
  }));
}

function team(
  id: string,
  groupId: string,
  rank: number,
  gf: number = 0,
  gd: number = 0,
  ga: number = 0,
  manualSeed: number | null = null
): QualifiedTeam {
  return { team_id: id, groupId, rank, gf, gd, ga, manualSeed };
}

// ---------------------------------------------------------------------------
// standardSeedSlots
// ---------------------------------------------------------------------------

describe("standardSeedSlots", () => {
  it("returns [1,2] for B=2", () => {
    expect(standardSeedSlots(2)).toEqual([1, 2]);
  });
  it("returns [1,4,2,3] for B=4", () => {
    expect(standardSeedSlots(4)).toEqual([1, 4, 2, 3]);
  });
  it("returns [1,8,4,5,2,7,3,6] for B=8", () => {
    expect(standardSeedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it("places top seeds in opposite halves at B=16", () => {
    const slots = standardSeedSlots(16);
    // Seeds 1 and 2 must be in opposite halves (first vs second 8).
    const slot1 = slots.indexOf(1);
    const slot2 = slots.indexOf(2);
    expect((slot1 < 8) !== (slot2 < 8)).toBe(true);
  });
  it("rejects non-powers-of-two", () => {
    expect(() => standardSeedSlots(3)).toThrow();
    expect(() => standardSeedSlots(6)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeSeedOrder
// ---------------------------------------------------------------------------

describe("computeSeedOrder", () => {
  it("rank-major: all rank-0 teams come before rank-1 teams", () => {
    const order = computeSeedOrder([
      team("A2", "A", 1, 5),
      team("B1", "B", 0, 3),
      team("A1", "A", 0, 7),
      team("B2", "B", 1, 4),
    ]);
    expect(order.map((q) => q.team_id)).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("within the same rank, sorts by GF desc then GD desc then GA asc", () => {
    const order = computeSeedOrder([
      team("X", "X", 0, 10, 2, 8),
      team("Y", "Y", 0, 10, 5, 5),
      team("Z", "Z", 0, 9, 9, 0),
    ]);
    expect(order.map((q) => q.team_id)).toEqual(["Y", "X", "Z"]);
  });

  it("manual seeds override auto-rank entirely", () => {
    const order = computeSeedOrder([
      team("A1", "A", 0, 100, 100, 0),
      team("B1", "B", 0, 0, 0, 100, 1),
      team("A2", "A", 1, 50, 0, 50, 2),
    ]);
    expect(order.map((q) => q.team_id)).toEqual(["B1", "A2", "A1"]);
  });
});

// ---------------------------------------------------------------------------
// 4 groups × 2 — the canonical cross-group QF spec
// ---------------------------------------------------------------------------

describe("4 groups × 2 advance — cross-group QF", () => {
  // Auto-seed order will be 1A, 1B, 1C, 1D, 2A, 2B, 2C, 2D when groups are
  // listed alphabetically with equal standings.
  const qualified: QualifiedTeam[] = [
    team("1A", "A", 0), team("2A", "A", 1),
    team("1B", "B", 0), team("2B", "B", 1),
    team("1C", "C", 0), team("2C", "C", 1),
    team("1D", "D", 0), team("2D", "D", 1),
  ];

  it("produces the spec QF pairings 1A v 2D, 2A v 1D, 1B v 2C, 2B v 1C", () => {
    const matches = generateSeededFirstRound(qualified, makeCourts(4), TID, "A");
    expect(matches).toHaveLength(4);
    // Order: pair-index ascending → (1A,2D), (1D,2A), (1B,2C), (1C,2B)
    expect([matches[0].team1_id, matches[0].team2_id].sort()).toEqual(["1A", "2D"]);
    expect([matches[1].team1_id, matches[1].team2_id].sort()).toEqual(["1D", "2A"]);
    expect([matches[2].team1_id, matches[2].team2_id].sort()).toEqual(["1B", "2C"]);
    expect([matches[3].team1_id, matches[3].team2_id].sort()).toEqual(["1C", "2B"]);
  });

  it("emits all matches as quarter_final stage in bracket A", () => {
    const matches = generateSeededFirstRound(qualified, makeCourts(4), TID, "A");
    for (const m of matches) {
      expect(m.stage).toBe("quarter_final");
      expect(m.bracket).toBe("A");
      expect(m.round_number).toBe(1);
    }
  });

  it("distributes round-robin across courts", () => {
    const matches = generateSeededFirstRound(qualified, makeCourts(2), TID, "A");
    expect(matches.map((m) => m.court_id)).toEqual([
      "court-1",
      "court-2",
      "court-1",
      "court-2",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8 groups × 1 — pure top-seed bracket
// ---------------------------------------------------------------------------

describe("8 groups × 1 advance — pure seed bracket", () => {
  const qualified: QualifiedTeam[] = ["A", "B", "C", "D", "E", "F", "G", "H"].map(
    (g) => team(`1${g}`, g, 0)
  );

  it("pairs 1A v 1H, 1D v 1E, 1B v 1G, 1C v 1F", () => {
    const matches = generateSeededFirstRound(qualified, [], TID, "A");
    expect(matches).toHaveLength(4);
    expect([matches[0].team1_id, matches[0].team2_id].sort()).toEqual(["1A", "1H"]);
    expect([matches[1].team1_id, matches[1].team2_id].sort()).toEqual(["1D", "1E"]);
    expect([matches[2].team1_id, matches[2].team2_id].sort()).toEqual(["1B", "1G"]);
    expect([matches[3].team1_id, matches[3].team2_id].sort()).toEqual(["1C", "1F"]);
  });
});

// ---------------------------------------------------------------------------
// 3 groups × 2 — 6 teams, 2 byes, anti-rematch swap
// ---------------------------------------------------------------------------

describe("3 groups × 2 advance — byes for top 2 seeds", () => {
  const qualified: QualifiedTeam[] = [
    team("1A", "A", 0), team("2A", "A", 1),
    team("1B", "B", 0), team("2B", "B", 1),
    team("1C", "C", 0), team("2C", "C", 1),
  ];

  it("emits exactly 2 round-1 matches (others bye)", () => {
    const matches = generateSeededFirstRound(qualified, makeCourts(2), TID, "A");
    expect(matches).toHaveLength(2);
  });

  it("never pairs two teams from the same group in round 1", () => {
    const matches = generateSeededFirstRound(qualified, makeCourts(2), TID, "A");
    for (const m of matches) {
      const g1 = qualified.find((q) => q.team_id === m.team1_id)!.groupId;
      const g2 = qualified.find((q) => q.team_id === m.team2_id)!.groupId;
      expect(g1).not.toBe(g2);
    }
  });

  it("bye pair indices identify the top two seeds (1A and 1B)", () => {
    const order = computeSeedOrder(qualified);
    const ids = order.map((q) => q.team_id);
    const byes = computeSeededByePairIndices(ids);
    expect(byes.map((b) => b.teamId).sort()).toEqual(["1A", "1B"]);
  });

  it("first-round stage is quarter_final (play-in for SF)", () => {
    const matches = generateSeededFirstRound(qualified, makeCourts(2), TID, "A");
    for (const m of matches) {
      expect(m.stage).toBe("quarter_final");
    }
  });
});

// ---------------------------------------------------------------------------
// Manual seed overrides
// ---------------------------------------------------------------------------

describe("manual seeds drive bracket placement", () => {
  it("a manually-seeded #1 takes slot 1 regardless of group rank", () => {
    const qualified: QualifiedTeam[] = [
      team("X", "A", 0, /*gf*/ 0, 0, 0, /*seed*/ 1), // manual seed 1
      team("Y", "B", 0, 50),
      team("Z", "A", 1, 30),
      team("W", "B", 1, 20),
    ];
    const matches = generateSeededFirstRound(qualified, [], TID, "A");
    expect(matches).toHaveLength(2);
    // Seed order: X (manual 1), then Y/Z/W by rank+GF. Pair 0 = seed1 vs seed4
    // (lowest of the three remaining). The seeded slot order is [1,4,2,3] for B=4.
    // So pair 0: seed1 (X) vs seed4, pair 1: seed2 vs seed3.
    // Auto order of Y/Z/W: Y rank0 50, Z rank1 30, W rank1 20 → seeds 2,3,4.
    // Matches: pair0 (X, W), pair1 (Y, Z).
    expect([matches[0].team1_id, matches[0].team2_id].sort()).toEqual(["W", "X"]);
    expect([matches[1].team1_id, matches[1].team2_id].sort()).toEqual(["Y", "Z"]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — small N
// ---------------------------------------------------------------------------

describe("small fields", () => {
  it("N=2 → single Final", () => {
    const qualified: QualifiedTeam[] = [
      team("A1", "A", 0), team("B1", "B", 0),
    ];
    const matches = generateSeededFirstRound(qualified, [], TID, "A");
    expect(matches).toHaveLength(1);
    expect(matches[0].stage).toBe("final");
  });

  it("N=4 → two SFs in seeded order", () => {
    const qualified: QualifiedTeam[] = [
      team("1A", "A", 0, 100), team("1B", "B", 0, 90),
      team("1C", "C", 0, 80), team("1D", "D", 0, 70),
    ];
    const matches = generateSeededFirstRound(qualified, makeCourts(2), TID, "A");
    expect(matches).toHaveLength(2);
    expect(matches[0].stage).toBe("semi_final");
    // Slot order for 4: [1,4,2,3] → pair 0: seed1 v seed4 (1A v 1D), pair 1: seed2 v seed3 (1B v 1C)
    expect([matches[0].team1_id, matches[0].team2_id].sort()).toEqual(["1A", "1D"]);
    expect([matches[1].team1_id, matches[1].team2_id].sort()).toEqual(["1B", "1C"]);
  });
});

// ---------------------------------------------------------------------------
// buildBracketSlots
// ---------------------------------------------------------------------------

describe("buildBracketSlots", () => {
  it("places seeds into slot positions, BYEs as null", () => {
    const slots = buildBracketSlots(["s1", "s2", "s3"]);
    expect(slots).toHaveLength(4);
    // B=4 slot seeds = [1,4,2,3]
    // seed 1 = s1 → slot 0
    // seed 4 = BYE (only 3 teams) → slot 1
    // seed 2 = s2 → slot 2
    // seed 3 = s3 → slot 3
    expect(slots).toEqual(["s1", null, "s2", "s3"]);
  });
});
