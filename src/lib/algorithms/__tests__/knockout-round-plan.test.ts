import { describe, it, expect } from "vitest";
import {
  bracketRoundPlan,
  playoffRoundPlan,
  playoffStageCourts,
} from "../knockout";

describe("bracketRoundPlan mirrors the generated bracket", () => {
  it("2 teams → a single final", () => {
    expect(bracketRoundPlan(2, false)).toEqual([{ stage: "final", matches: 1 }]);
  });

  it("3 teams → 1 play-in then the final, no bronze possible", () => {
    expect(bracketRoundPlan(3, true)).toEqual([
      { stage: "sf", matches: 1 },
      { stage: "final", matches: 1 },
    ]);
  });

  it("4 teams → 2 SF then the final", () => {
    expect(bracketRoundPlan(4, false)).toEqual([
      { stage: "sf", matches: 2 },
      { stage: "final", matches: 1 },
    ]);
  });

  it("5-8 teams → one QF round of n-4, top seeds on bye", () => {
    expect(bracketRoundPlan(5, false)[0]).toEqual({ stage: "qf", matches: 1 });
    expect(bracketRoundPlan(8, false)[0]).toEqual({ stage: "qf", matches: 4 });
  });

  it("12 teams → 4 play-in + 4 QF + 2 SF + 1 final, never 8 at once", () => {
    expect(bracketRoundPlan(12, false)).toEqual([
      { stage: "qf", matches: 4 },
      { stage: "qf", matches: 4 },
      { stage: "sf", matches: 2 },
      { stage: "final", matches: 1 },
    ]);
  });

  it("9 teams → 1 play-in feeding a full 4-match QF", () => {
    expect(bracketRoundPlan(9, false)).toEqual([
      { stage: "qf", matches: 1 },
      { stage: "qf", matches: 4 },
      { stage: "sf", matches: 2 },
      { stage: "final", matches: 1 },
    ]);
  });

  it("bronze shares the final round rather than adding one", () => {
    const plan = bracketRoundPlan(8, true);
    expect(plan[plan.length - 1]).toEqual({ stage: "final", matches: 2 });
    expect(plan).toHaveLength(3);
  });

  it("every round halves the field down to one winner", () => {
    for (let n = 2; n <= 16; n++) {
      const plan = bracketRoundPlan(n, false);
      let alive = n;
      for (const r of plan) alive -= r.matches; // each match eliminates one team
      expect(alive).toBe(1);
    }
  });
});

describe("playoffRoundPlan across auto-brackets", () => {
  it("sums parallel brackets round by round", () => {
    // 16 advancing → A- and B-slutspel, both 8 teams.
    expect(playoffRoundPlan(16, false)).toEqual([
      { stage: "qf", matches: 8 },
      { stage: "sf", matches: 4 },
      { stage: "final", matches: 2 },
    ]);
  });

  it("is empty below two teams", () => {
    expect(playoffRoundPlan(1, false)).toEqual([]);
  });
});

describe("playoffStageCourts", () => {
  it("reports the busiest round of a stage, not the stage total", () => {
    expect(playoffStageCourts(12, false)).toEqual([
      { stage: "qf", courts: 4, rounds: 2 },
      { stage: "sf", courts: 2, rounds: 1 },
      { stage: "final", courts: 1, rounds: 1 },
    ]);
  });

  it("counts the bronze match as a parallel final court", () => {
    expect(playoffStageCourts(4, true)).toEqual([
      { stage: "sf", courts: 2, rounds: 1 },
      { stage: "final", courts: 2, rounds: 1 },
    ]);
  });

  it("never recommends more courts than half the field", () => {
    for (let n = 2; n <= 16; n++) {
      for (const st of playoffStageCourts(n, true)) {
        expect(st.courts).toBeLessThanOrEqual(Math.floor(n / 2));
      }
    }
  });
});
