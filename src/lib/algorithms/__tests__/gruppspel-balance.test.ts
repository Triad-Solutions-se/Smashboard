import { describe, it, expect } from "vitest";
import {
  balanceGroupGamesByTime,
  groupMinutes,
  groupSlots,
  roundsForGroup,
  matchMinutes,
  maxStretchedGames,
  expectedGamesPlayed,
  MAX_GAMES_PER_MATCH,
} from "../gruppspel";

function sizesFor(teams: number, groups: number): number[] {
  const base = Math.floor(teams / groups);
  const rem = teams % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < rem ? 1 : 0));
}

// Courts split as evenly as the group count allows — what the setup wizard
// suggests and what a host ends up with.
function courtsFor(courts: number, groups: number): number[] {
  return Array.from({ length: groups }, (_, i) =>
    Math.max(1, Math.floor(courts / groups) + (i < courts % groups ? 1 : 0))
  );
}

describe("roundsForGroup", () => {
  it("gives odd groups a bye round", () => {
    expect(roundsForGroup(2)).toBe(1);
    expect(roundsForGroup(3)).toBe(3);
    expect(roundsForGroup(4)).toBe(3);
    expect(roundsForGroup(5)).toBe(5);
    expect(roundsForGroup(1)).toBe(0);
  });
});

describe("groupSlots", () => {
  it("queues matches when a group has fewer courts than concurrent matches", () => {
    expect(groupSlots(8, 4)).toBe(7); // 4 matches per round, 4 courts → 1 slot
    expect(groupSlots(8, 2)).toBe(14); // same rounds, twice the slots
    expect(groupSlots(8, 1)).toBe(28);
  });
});

describe("balanceGroupGamesByTime", () => {
  it("leaves equal groups on the host's base value", () => {
    expect(balanceGroupGamesByTime(5, [6, 6, 6], [2, 2, 2])).toEqual([5, 5, 5]);
  });

  it("stretches matches for the group that would otherwise finish early", () => {
    const games = balanceGroupGamesByTime(5, [5, 4], [1, 1]);
    expect(games[0]).toBe(5);
    expect(games[1]).toBeGreaterThan(5);
  });

  it("accounts for courts, not just team counts", () => {
    // Same size, but the two-court group plays its rounds in half the slots,
    // so it needs longer matches to fill the same window.
    const [a, b] = balanceGroupGamesByTime(5, [6, 6], [2, 1]);
    expect(a).toBeGreaterThan(b);
  });

  it("keeps every group within 10% of the longest, or stops at the stretch cap", () => {
    for (let teams = 4; teams <= 50; teams++) {
      // The wizard caps groups so no group can hold fewer than 2 teams.
      for (let groups = 1; groups <= Math.min(8, Math.floor(teams / 2)); groups++) {
        for (const courts of [1, 2, 4, 6, 8]) {
          const sizes = sizesFor(teams, groups);
          const perGroupCourts = courtsFor(courts, groups);
          const games = balanceGroupGamesByTime(5, sizes, perGroupCourts);
          expect(Math.min(...games)).toBeGreaterThanOrEqual(1);
          expect(Math.max(...games)).toBeLessThanOrEqual(maxStretchedGames(5));

          const minutes = sizes.map((n, i) =>
            groupMinutes(n, perGroupCourts[i], games[i])
          );
          const longest = Math.max(...minutes);
          minutes.forEach((m, i) => {
            // A group is either balanced to within 10% of the longest, or it
            // has hit the stretch cap and is deliberately finishing early.
            const balanced = (longest - m) / longest < 0.1;
            expect(balanced || games[i] === maxStretchedGames(5)).toBe(true);
          });
        }
      }
    }
  });

  it("never stretches a group past the cap, even beside a far slower group", () => {
    // 3 teams vs 2 teams on one court each: the 2-team group has a single
    // match to fill the other group's whole window. Before the cap it was
    // handed a 24-game match; now it plays a long-but-sane one and waits.
    const games = balanceGroupGamesByTime(5, [3, 2], [1, 1]);
    expect(games[0]).toBe(5);
    expect(games[1]).toBe(maxStretchedGames(5));
    expect(games[1]).toBe(6); // MAX_BALANCED_GAMES — the venue never plays longer
  });

  it("lands on the closest whole match length to the slowest group's window", () => {
    for (let teams = 4; teams <= 30; teams++) {
      for (let groups = 1; groups <= Math.min(6, Math.floor(teams / 2)); groups++) {
        const sizes = sizesFor(teams, groups);
        const perGroupCourts = courtsFor(4, groups);
        const games = balanceGroupGamesByTime(5, sizes, perGroupCourts);
        const slots = sizes.map((n, i) => groupSlots(n, perGroupCourts[i]));
        const target = Math.max(...slots.map((s) => s * matchMinutes(5)));
        const cap = maxStretchedGames(5);
        slots.forEach((s, i) => {
          const chosen = Math.abs(target - s * matchMinutes(games[i]));
          for (let g = 1; g <= cap; g++) {
            expect(Math.abs(target - s * matchMinutes(g))).toBeGreaterThanOrEqual(
              chosen
            );
          }
        });
      }
    }
  });

  it("never returns a value below 1 game", () => {
    // A tiny group next to a huge one would otherwise round towards zero.
    const games = balanceGroupGamesByTime(1, [20, 2], [1, 8]);
    expect(Math.min(...games)).toBeGreaterThanOrEqual(1);
  });
});

describe("matchMinutes", () => {
  it("models a first-to-N match, not an exactly-N one", () => {
    // first-to-5 runs 5-9 games; Bon Padel's lopsided sets put it near 5.6.
    expect(expectedGamesPlayed(5)).toBeCloseTo(5.6);
    expect(matchMinutes(5)).toBe(22); // 5.6 games x 3 min + 5 min changeover
    expect(expectedGamesPlayed(10)).toBeCloseTo(11.35);
    expect(matchMinutes(10)).toBe(39);
    // Still strictly more than the target — a whitewash is the floor, not the
    // expectation. This is the property the whole correction turned on.
    for (let t = 2; t <= 12; t++) {
      expect(expectedGamesPlayed(t)).toBeGreaterThan(t);
    }
  });

  it("is bounded by the whitewash and the maximum-length match", () => {
    for (let target = 1; target <= 20; target++) {
      const games = expectedGamesPlayed(target);
      expect(games).toBeGreaterThanOrEqual(target);
      expect(games).toBeLessThanOrEqual(2 * target - 1);
    }
  });

  it("increases strictly with the target so the balancer can invert it", () => {
    for (let target = 1; target < 40; target++) {
      expect(matchMinutes(target + 1)).toBeGreaterThan(matchMinutes(target));
    }
  });
});

describe("maxStretchedGames", () => {
  it("allows at most 1.5x the host's setting", () => {
    expect(maxStretchedGames(1)).toBe(2);
    expect(maxStretchedGames(3)).toBe(5);
  });

  it("never proposes a match longer than the venue actually plays", () => {
    // 1.5x5 would be 8, but MASTER.xlsx tops out at 7 and lives on 5-6.
    expect(maxStretchedGames(4)).toBe(6);
    expect(maxStretchedGames(5)).toBe(6);
    expect(maxStretchedGames(6)).toBe(6);
  });

  it("still honours a host who deliberately picks a long match", () => {
    expect(maxStretchedGames(7)).toBe(7);
    expect(maxStretchedGames(9)).toBe(9);
  });

  it("never goes below the base", () => {
    for (let base = 1; base <= 20; base++) {
      expect(maxStretchedGames(base)).toBeGreaterThanOrEqual(base);
    }
  });
});
