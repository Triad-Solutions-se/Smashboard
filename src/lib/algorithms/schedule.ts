// Whole-tournament wall-clock model: group stage + knockout.
//
// This is the single implementation of "how long will this take". The setup
// wizard reads it forwards (given a match length, when are we done?) and
// backwards (given a finish time, how long may a match be?) — keeping both
// directions on one function is what stops the two from drifting apart.

import {
  balanceGroupGamesByTime,
  groupStageMinutes,
  matchMinutes,
  MAX_GAMES_PER_MATCH,
} from "./gruppspel";
import { playoffRoundPlan } from "./knockout";

export type TimeEstimate = {
  matchMinutes: number;
  groupMinutes: number;
  playoffMinutes: number;
  totalMinutes: number;
};

export type ScheduleShape = {
  teamsPerGroup: number[];
  courtsPerGroup: number[];
  /** Teams advancing per group; 0 = no playoff. */
  advancesPerGroup: number;
  hasBronze: boolean;
  /** Courts available to the knockout, which runs after the groups. */
  activeCourts: number;
};

export function estimateTournamentTime(
  shape: ScheduleShape,
  groupGamesPerMatch: number[],
  playoffGames: number
): TimeEstimate {
  const { teamsPerGroup, courtsPerGroup, advancesPerGroup, hasBronze, activeCourts } =
    shape;
  const perMatch = matchMinutes(playoffGames);
  const zero: TimeEstimate = {
    matchMinutes: perMatch,
    groupMinutes: 0,
    playoffMinutes: 0,
    totalMinutes: 0,
  };
  if (teamsPerGroup.length === 0 || activeCourts < 1) return zero;

  // Each group runs on its own courts in parallel; the group stage is over
  // when the slowest group is.
  const groupMins = groupStageMinutes(
    teamsPerGroup,
    courtsPerGroup,
    groupGamesPerMatch
  );

  let playoffMinutes = 0;
  if (advancesPerGroup > 0 && teamsPerGroup.length > 0) {
    const totalAdvancing = advancesPerGroup * teamsPerGroup.length;
    // Walk the real round sequence — a stage can span several rounds (a
    // 12-team bracket plays a play-in round AND a quarter-final round), and
    // each round costs its own slot on court.
    for (const round of playoffRoundPlan(totalAdvancing, hasBronze)) {
      playoffMinutes += Math.ceil(round.matches / activeCourts) * perMatch;
    }
  }

  return {
    matchMinutes: perMatch,
    groupMinutes: groupMins,
    playoffMinutes,
    totalMinutes: groupMins + playoffMinutes,
  };
}

// Forward direction with everything derived from one games-per-match setting:
// groups get time-balanced around it and the playoff inherits it. This is the
// shape the wizard is in before a host overrides anything by hand.
export function estimateForBase(
  shape: ScheduleShape,
  base: number
): TimeEstimate {
  const groupGames = balanceGroupGamesByTime(
    base,
    shape.teamsPerGroup,
    shape.courtsPerGroup
  );
  return estimateTournamentTime(shape, groupGames, base);
}

export type BudgetSolution = {
  /** Games-per-match to use. Always ≥ 1, even when nothing fits. */
  games: number;
  /** What that actually takes. */
  minutes: number;
  /** False when even a 1-game match overruns the budget. */
  fits: boolean;
  /** Budget minus minutes. Negative when the tournament overruns. */
  slackMinutes: number;
};

// Backwards direction: the longest match length that still finishes inside
// `budgetMinutes`. Total time rises monotonically with the games setting, so a
// linear walk from 1 finds it — no closed-form inverse to fall out of sync
// with the model when a constant is retuned.
export function solveGamesForBudget(
  budgetMinutes: number,
  shape: ScheduleShape
): BudgetSolution {
  const at = (g: number) => estimateForBase(shape, g).totalMinutes;
  const floorMinutes = at(1);
  if (budgetMinutes < floorMinutes) {
    return {
      games: 1,
      minutes: floorMinutes,
      fits: false,
      slackMinutes: budgetMinutes - floorMinutes,
    };
  }
  let games = 1;
  while (games < MAX_GAMES_PER_MATCH && at(games + 1) <= budgetMinutes) games++;
  const minutes = at(games);
  return {
    games,
    minutes,
    fits: true,
    slackMinutes: budgetMinutes - minutes,
  };
}
