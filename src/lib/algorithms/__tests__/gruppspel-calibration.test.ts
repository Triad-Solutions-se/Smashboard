import { describe, it, expect } from "vitest";
import {
  expectedGamesPlayed,
  matchMinutes,
  MINUTES_PER_GAME,
  MATCH_OVERHEAD_MIN,
} from "../gruppspel";

// Reference padel timings the wall-clock model is calibrated against:
//
//   single game     3-5 min
//   single set      18-30 min   (first to 6)
//   two-set match   45-65 min   (straight sets)
//
// These pin MINUTES_PER_GAME and MATCH_OVERHEAD_MIN to something outside the
// codebase. If a future change to the model breaks one of these, the model has
// drifted away from how long padel actually takes — retune the constants
// rather than relaxing the test.

/** Playing time only, excluding the per-match overhead. */
function playMinutes(target: number): number {
  return expectedGamesPlayed(target) * MINUTES_PER_GAME;
}

describe("wall-clock model against real padel timings", () => {
  it("puts a single game in the 3-5 minute band", () => {
    expect(MINUTES_PER_GAME).toBeGreaterThanOrEqual(3);
    expect(MINUTES_PER_GAME).toBeLessThanOrEqual(5);
  });

  it("puts a first-to-6 set in the 18-30 minute band", () => {
    // Typical set (6-4-ish, 8.5 games on the neutral loser assumption).
    expect(playMinutes(6)).toBeGreaterThanOrEqual(18);
    expect(playMinutes(6)).toBeLessThanOrEqual(30);
  });

  it("puts the shortest and longest first-to-6 sets around that band", () => {
    const whitewash = 6 * MINUTES_PER_GAME; // 6-0
    const marathon = 11 * MINUTES_PER_GAME; // 6-5
    expect(whitewash).toBeGreaterThanOrEqual(18);
    expect(marathon).toBeLessThanOrEqual(36); // 30 min band + tiebreak tail
  });

  it("puts a straight-sets two-set match in the 45-65 minute band", () => {
    const twoSets = 2 * playMinutes(6) + MATCH_OVERHEAD_MIN;
    expect(twoSets).toBeGreaterThanOrEqual(45);
    expect(twoSets).toBeLessThanOrEqual(65);
  });

  it("rules out 4 min/game — it would overrun both aggregate figures", () => {
    // Documents why the single-game band's midpoint is not what we use: the
    // set and match figures already include changeovers, so they measure the
    // marginal cost of a game, and 4 breaks both.
    const at4 = expectedGamesPlayed(6) * 4;
    expect(at4).toBeGreaterThan(30); // a set would run long
    expect(2 * at4 + MATCH_OVERHEAD_MIN).toBeGreaterThan(65); // so would a match
  });

  it("prices the format the app actually runs", () => {
    expect(matchMinutes(5)).toBe(26); // first to 5, ~7 games
    expect(matchMinutes(6)).toBe(31); // first to 6, ~8.5 games
  });
});
