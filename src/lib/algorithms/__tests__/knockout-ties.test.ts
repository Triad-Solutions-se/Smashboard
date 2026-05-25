// Regression tests: drawn or unscored KO matches must not silently advance.
import { describe, it, expect } from "vitest";
import {
  generateNextKORound,
  getKOWinnerId,
  getKOLoserId,
  KOTieError,
} from "../knockout";
import type { Court, TournamentMatch } from "../../supabase/types";

const TID = "t1";
const courts: Court[] = [{ id: "c1" } as Court];

function sf(
  id: string,
  team1: string,
  team2: string,
  s1: number | null,
  s2: number | null
): TournamentMatch {
  return {
    id,
    tournament_id: TID,
    group_id: null,
    round_number: 1,
    court_id: "c1",
    team1_id: team1,
    team2_id: team2,
    score_team1: s1,
    score_team2: s2,
    status: "completed",
    stage: "semi_final",
    bracket: "A",
    created_at: "",
  } as TournamentMatch;
}

describe("getKOWinnerId / getKOLoserId", () => {
  it("returns the higher-score team as winner", () => {
    const m = sf("m", "A", "B", 6, 4);
    expect(getKOWinnerId(m)).toBe("A");
    expect(getKOLoserId(m)).toBe("B");
  });

  it("returns null on tie", () => {
    const m = sf("m", "A", "B", 5, 5);
    expect(getKOWinnerId(m)).toBeNull();
    expect(getKOLoserId(m)).toBeNull();
  });

  it("returns null when a score is missing", () => {
    expect(getKOWinnerId(sf("m", "A", "B", null, 4))).toBeNull();
    expect(getKOWinnerId(sf("m", "A", "B", 4, null))).toBeNull();
    expect(getKOWinnerId(sf("m", "A", "B", null, null))).toBeNull();
  });
});

describe("generateNextKORound refuses to advance past a tie", () => {
  it("throws KOTieError when one semi is tied 5-5", () => {
    const sfs = [sf("sf1", "A", "B", 5, 5), sf("sf2", "C", "D", 6, 4)];
    expect(() => generateNextKORound(sfs, [], courts, TID, false)).toThrow(
      KOTieError
    );
  });

  it("throws KOTieError when scores are missing", () => {
    const sfs = [
      sf("sf1", "A", "B", null, null),
      sf("sf2", "C", "D", 6, 4),
    ];
    expect(() => generateNextKORound(sfs, [], courts, TID, false)).toThrow(
      KOTieError
    );
  });

  it("still advances cleanly when all matches have a clear winner", () => {
    const sfs = [sf("sf1", "A", "B", 6, 4), sf("sf2", "C", "D", 3, 5)];
    const next = generateNextKORound(sfs, [], courts, TID, false);
    expect(next).toHaveLength(1);
    expect(next[0].stage).toBe("final");
    expect([next[0].team1_id, next[0].team2_id].sort()).toEqual(["A", "D"]);
  });
});
