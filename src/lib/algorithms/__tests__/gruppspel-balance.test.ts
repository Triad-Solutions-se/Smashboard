import { describe, it, expect } from "vitest";
import {
  balanceGroupGamesByTime,
  groupMinutes,
  groupSlots,
  roundsForGroup,
  matchMinutes,
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

  it("keeps every group within 10% of the longest across the whole grid", () => {
    for (let teams = 4; teams <= 50; teams++) {
      // The wizard caps groups so no group can hold fewer than 2 teams.
      for (let groups = 1; groups <= Math.min(8, Math.floor(teams / 2)); groups++) {
        for (const courts of [1, 2, 4, 6, 8]) {
          const sizes = sizesFor(teams, groups);
          const perGroupCourts = courtsFor(courts, groups);
          const games = balanceGroupGamesByTime(5, sizes, perGroupCourts);
          expect(Math.min(...games)).toBeGreaterThanOrEqual(1);
          expect(Math.max(...games)).toBeLessThanOrEqual(MAX_GAMES_PER_MATCH);

          const minutes = sizes.map((n, i) =>
            groupMinutes(n, perGroupCourts[i], games[i])
          );
          const spread = Math.max(...minutes) - Math.min(...minutes);
          expect(spread / Math.max(...minutes)).toBeLessThan(0.1);
        }
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
  it("is games plus fixed changeover overhead", () => {
    expect(matchMinutes(5)).toBe(20);
    expect(matchMinutes(10)).toBe(35);
  });
});
