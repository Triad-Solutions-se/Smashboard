import { describe, it, expect } from "vitest";
import { maxAdvances, autoBracketSizes } from "../knockout";

import { venueTemplate } from "../venue-templates";

describe("maxAdvances", () => {
  it("keeps as many teams playing as the bracket allows", () => {
    expect(maxAdvances(13, 2)).toBe(6); // 12 of 13 advance, one 12-bracket
    expect(maxAdvances(16, 4)).toBe(4); // 16 advance → A + B slutspel
    expect(maxAdvances(24, 4)).toBe(6); // 24 advance → A + B + C
    expect(maxAdvances(32, 4)).toBe(8); // 32 advance → A + B + C + D
  });

  it("steps back from a total the bracket generator cannot lay out", () => {
    // 20 teams / 4 groups could advance 5 each = 20, but a 20-team single
    // bracket is not buildable and 20 is not a multiple of 8. So 4 → 16.
    expect(maxAdvances(20, 4)).toBe(4);
    expect(maxAdvances(28, 4)).toBe(6); // 28 → not clean; 24 is
  });

  it("only ever produces a total the auto-bracketing supports", () => {
    for (let teams = 4; teams <= 60; teams++) {
      for (let groups = 1; groups <= Math.floor(teams / 2); groups++) {
        const a = maxAdvances(teams, groups);
        if (a === 0) continue;
        const total = groups * a;
        expect(total).toBeLessThanOrEqual(teams);
        // Either one buildable bracket, or a clean split into 8s.
        const sizes = autoBracketSizes(total);
        expect(sizes.every((s) => s <= 16)).toBe(true);
      }
    }
  });

  it("never advances more teams than the smallest group holds", () => {
    for (let teams = 4; teams <= 60; teams++) {
      for (let groups = 1; groups <= Math.floor(teams / 2); groups++) {
        expect(maxAdvances(teams, groups)).toBeLessThanOrEqual(
          Math.floor(teams / groups)
        );
      }
    }
  });

  it("gives every venue template a workable bracket", () => {
    for (let teams = 4; teams <= 60; teams++) {
      const t = venueTemplate(teams);
      if (!t) continue;
      const a = maxAdvances(teams, t.groups);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(autoBracketSizes(t.groups * a).every((s) => s <= 16)).toBe(true);
    }
  });
});
