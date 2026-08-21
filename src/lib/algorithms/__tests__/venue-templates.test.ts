import { describe, it, expect } from "vitest";
import { recommendedGames, venueTemplate } from "../venue-templates";
import { MAX_BALANCED_GAMES, maxStretchedGames } from "../gruppspel";

describe("venueTemplate", () => {
  it("matches the drawsheets in MASTER.xlsx", () => {
    // Spot-checks against sheets where several drawsheets agree.
    expect(venueTemplate(12)).toEqual({ groups: 2, games: 5 }); // 5 sheets
    expect(venueTemplate(16)).toEqual({ groups: 4, games: 6 }); // 2 sheets
    expect(venueTemplate(28)).toEqual({ groups: 4, games: 5 }); // 2 sheets
    expect(venueTemplate(13)).toEqual({ groups: 2, games: 6 }); // 2 sheets
  });

  it("has no template for sizes the venue runs as Americano", () => {
    // 8, 32 and 40 are "BÄST AV n POÄNG" sheets — a different format.
    expect(venueTemplate(8)).toBeNull();
    expect(venueTemplate(32)).toBeNull();
    expect(venueTemplate(40)).toBeNull();
  });
});

describe("recommendedGames", () => {
  it("returns the exact template when there is one", () => {
    expect(recommendedGames(12)).toBe(5);
    expect(recommendedGames(16)).toBe(6);
  });

  it("interpolates from the nearest field sizes otherwise", () => {
    expect(recommendedGames(22)).toBe(5); // nearer 21 (5) than 28
    expect(recommendedGames(5)).toBe(6); // nearer 4 and 6, both 6
    // Equidistant between two templates → the shorter match wins.
    expect(recommendedGames(11)).toBe(5); // 10 says 6, 12 says 5
    expect(recommendedGames(15)).toBe(5); // 14 says 5, 16 says 6
  });

  it("never leaves the 4-7 band the venue actually plays", () => {
    for (let n = 2; n <= 60; n++) {
      expect(recommendedGames(n)).toBeGreaterThanOrEqual(4);
      expect(recommendedGames(n)).toBeLessThanOrEqual(7);
    }
  });

  it("never recommends a length the balancer would then refuse to stretch to", () => {
    for (let n = 4; n <= 60; n++) {
      const rec = recommendedGames(n);
      expect(maxStretchedGames(rec)).toBeGreaterThanOrEqual(rec);
    }
  });

  it("agrees with the balancer's ceiling", () => {
    // Both are derived from the same drawsheets; if one moves the other should.
    const all = Array.from({ length: 60 }, (_, i) => recommendedGames(i + 2));
    expect(Math.max(...all)).toBeGreaterThanOrEqual(MAX_BALANCED_GAMES);
  });
});
