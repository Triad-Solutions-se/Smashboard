import { describe, it, expect } from "vitest";
import {
  estimateForBase,
  solveGamesForBudget,
  type ScheduleShape,
} from "../schedule";
import { MAX_GAMES_PER_MATCH } from "../gruppspel";

const shape = (over: Partial<ScheduleShape> = {}): ScheduleShape => ({
  teamsPerGroup: [5, 4, 4],
  courtsPerGroup: [2, 2, 2],
  advancesPerGroup: 4,
  hasBronze: false,
  activeCourts: 6,
  ...over,
});

describe("estimateForBase", () => {
  it("rises monotonically with the match length", () => {
    const s = shape();
    for (let g = 1; g < 30; g++) {
      expect(estimateForBase(s, g + 1).totalMinutes).toBeGreaterThan(
        estimateForBase(s, g).totalMinutes
      );
    }
  });

  it("counts the playoff only when teams advance", () => {
    expect(estimateForBase(shape({ advancesPerGroup: 0 }), 5).playoffMinutes).toBe(0);
    expect(estimateForBase(shape(), 5).playoffMinutes).toBeGreaterThan(0);
  });
});

describe("solveGamesForBudget", () => {
  it("returns the longest match that still fits the budget", () => {
    const s = shape();
    const sol = solveGamesForBudget(240, s);
    expect(sol.fits).toBe(true);
    expect(sol.minutes).toBeLessThanOrEqual(240);
    // One game longer must not fit — otherwise it isn't the longest.
    expect(estimateForBase(s, sol.games + 1).totalMinutes).toBeGreaterThan(240);
  });

  it("never overruns the budget it reports as fitting", () => {
    const s = shape();
    for (let budget = 30; budget <= 600; budget += 5) {
      const sol = solveGamesForBudget(budget, s);
      if (sol.fits) {
        expect(sol.minutes).toBeLessThanOrEqual(budget);
        expect(sol.slackMinutes).toBeGreaterThanOrEqual(0);
      } else {
        expect(sol.games).toBe(1);
        expect(sol.slackMinutes).toBeLessThan(0);
      }
    }
  });

  it("flags a budget that cannot be met even at one game per match", () => {
    const sol = solveGamesForBudget(10, shape());
    expect(sol.fits).toBe(false);
    expect(sol.games).toBe(1);
    expect(sol.minutes).toBeGreaterThan(10);
  });

  it("round-trips against the forward estimate", () => {
    const s = shape();
    for (let g = 1; g <= 12; g++) {
      const minutes = estimateForBase(s, g).totalMinutes;
      // Budgeting exactly what a setting costs must give that setting back.
      expect(solveGamesForBudget(minutes, s).games).toBe(g);
    }
  });

  it("buys longer matches when more courts are available", () => {
    const few = solveGamesForBudget(240, shape({ courtsPerGroup: [1, 1, 1], activeCourts: 3 }));
    const many = solveGamesForBudget(240, shape());
    expect(many.games).toBeGreaterThan(few.games);
  });

  it("stays within the hard games ceiling on an absurd budget", () => {
    const sol = solveGamesForBudget(100_000, shape());
    expect(sol.games).toBeLessThanOrEqual(MAX_GAMES_PER_MATCH);
  });
});
