import type {
  Court,
  TournamentTeam,
  TournamentGroup,
  TournamentMatch,
} from "../supabase/types";

export type ManualTeamInput = {
  player1_id: string;
  player2_id: string;
};

export type GroupAssignment = {
  group: Omit<TournamentGroup, "id" | "tournament_id">;
  teams: ManualTeamInput[];
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function distributeTeamsToGroups(
  teams: ManualTeamInput[],
  numGroups: number
): GroupAssignment[] {
  const shuffled = shuffle(teams);
  const buckets: ManualTeamInput[][] = Array.from(
    { length: numGroups },
    () => []
  );
  shuffled.forEach((team, idx) => {
    buckets[idx % numGroups].push(team);
  });
  return buckets.map((teamsInGroup, idx) => ({
    group: {
      name: `Grupp ${idx + 1}`,
      sort_order: idx,
      games_per_match: null,
    },
    teams: teamsInGroup,
  }));
}

// Returns round-robin pairs per round. null means that team slot is resting.
// Returned as [pairIndex] index into the teams array, or null for the bye slot.
function roundRobinPairs(numTeams: number): Array<{ pairs: Array<[number, number]>; restingIdx: number | null }> {
  const teams = Array.from({ length: numTeams }, (_, i) => i);
  const hasBye = teams.length % 2 === 1;
  if (hasBye) teams.push(-1);
  const n = teams.length;
  const rounds: Array<{ pairs: Array<[number, number]>; restingIdx: number | null }> = [];

  const fixed = teams[0];
  let rotating = teams.slice(1);

  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[number, number]> = [];
    let restingIdx: number | null = null;
    const slot = [fixed, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const a = slot[i];
      const b = slot[n - 1 - i];
      if (a === -1 || b === -1) {
        restingIdx = a === -1 ? b : a;
      } else {
        pairs.push([a, b]);
      }
    }
    rounds.push({ pairs, restingIdx });
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }

  return rounds;
}

export type GeneratedMatch = Omit<TournamentMatch, "id" | "created_at">;

// Map from round_number (1-based) to resting team_id, for groups with odd team counts.
export type RestingByRound = Map<number, string[]>;

export type GroupMatchResult = {
  matches: GeneratedMatch[];
  restingByRound: RestingByRound;
};

export function generateGroupMatches(
  teamsByGroup: Map<string, TournamentTeam[]>,
  courtsByGroup: Map<string, Court[]>
): GroupMatchResult {
  const groupIds = Array.from(teamsByGroup.keys());
  for (const gid of groupIds) {
    const c = courtsByGroup.get(gid);
    if (!c || c.length === 0) {
      throw new Error(`Inga banor tilldelade till grupp ${gid}.`);
    }
  }

  const perGroup = groupIds.map((gid) => {
    const teams = teamsByGroup.get(gid)!;
    const rounds = roundRobinPairs(teams.length);
    return rounds.map(({ pairs, restingIdx }) => ({
      pairs: pairs.map(([i, j]) => ({
        group_id: gid,
        team1_id: teams[i].id,
        team2_id: teams[j].id,
        tournament_id: teams[i].tournament_id,
      })),
      restingTeamId: restingIdx !== null ? teams[restingIdx].id : null,
    }));
  });

  const totalRounds = Math.max(...perGroup.map((g) => g.length));
  const matches: GeneratedMatch[] = [];
  const restingByRound: RestingByRound = new Map();

  for (let r = 0; r < totalRounds; r++) {
    const roundNumber = r + 1;
    for (let g = 0; g < perGroup.length; g++) {
      const gid = groupIds[g];
      const groupCourts = courtsByGroup.get(gid)!;
      const groupRound = perGroup[g][r];
      if (!groupRound) continue;

      if (groupRound.restingTeamId) {
        const existing = restingByRound.get(roundNumber) ?? [];
        existing.push(groupRound.restingTeamId);
        restingByRound.set(roundNumber, existing);
      }

      let courtIdx = 0;
      for (const m of groupRound.pairs) {
        const court = groupCourts[courtIdx % groupCourts.length];
        courtIdx++;
        matches.push({
          tournament_id: m.tournament_id,
          group_id: m.group_id,
          round_number: roundNumber,
          court_id: court.id,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          score_team1: null,
          score_team2: null,
          status: "scheduled",
          stage: "group",
          bracket: null,
        });
      }
    }
  }

  return { matches, restingByRound };
}

export function totalRoundsFor(numTeamsPerGroup: number[]): number {
  if (numTeamsPerGroup.length === 0) return 1;
  return Math.max(
    ...numTeamsPerGroup.map((n) => (n % 2 === 0 ? n - 1 : n))
  );
}

// ---------------------------------------------------------------------------
// Wall-clock model
//
// Groups run in parallel on their own courts, so what a player actually cares
// about is time on site, not match count. A group of n teams needs
// `roundsForGroup(n)` rounds; each round it must run floor(n/2) matches, and
// with fewer courts than that the matches queue up on the courts it has. The
// product is the number of sequential match slots the group occupies.
// ---------------------------------------------------------------------------

// Calibrated against padel reference timings, not guessed:
//   single game        3-5 min
//   single set         18-30 min  (first to 6)
//   two-set match      45-65 min  (straight sets)
//
// The set figure is the load-bearing one, because it already contains the
// changeovers between games and so gives the MARGINAL cost of a game inside
// continuous play: a 6-0 set is 18/6 = 3.0 min/game and a 6-4 set is
// 30/10 = 3.0. The "3-5 min" single-game figure sits higher because an
// isolated game carries its own setup. Scheduling cares about the marginal
// number, so 3 it is — see gruppspel-calibration.test.ts, which pins the
// model to these ranges.
export const MINUTES_PER_GAME = 3;

// Changeover, walking on, and getting the score entered — the per-match cost
// that isn't play. Backed out of the two-set figure: 2 sets of pure play at
// 3 min/game is ~51 min against a stated 45-65 min including breaks.
export const MATCH_OVERHEAD_MIN = 5;

export const MAX_GAMES_PER_MATCH = 99;

// A match is first-to-N, not exactly-N: the host score entry requires the
// winner to land on N and rejects draws, so the loser ends anywhere from 0 to
// N-1. A match therefore runs between N and 2N-1 games — the setting is the
// FLOOR of a match's length, never its length.
//
// TYPICAL_LOSER_SHARE is how much of the target the losing side is assumed to
// reach. 0.5 is the neutral assumption: a uniformly distributed loser score
// averages (N-1)/2, and it reproduces the reference set length below. Drop it
// towards 0 if a venue's matches run lopsided (0 models a whitewash every
// time, which is what this file assumed before).
export const TYPICAL_LOSER_SHARE = 0.5;

// Games actually played in a first-to-`target` match, on average.
export function expectedGamesPlayed(target: number): number {
  if (target < 1) return 0;
  return target + (target - 1) * TYPICAL_LOSER_SHARE;
}

// Wall-clock minutes for one match with the given games-per-match target.
export function matchMinutes(target: number): number {
  return Math.round(
    expectedGamesPlayed(target) * MINUTES_PER_GAME + MATCH_OVERHEAD_MIN
  );
}

// How far the time balancing may stretch a group's match length above the
// value the host actually typed. Past this the matches stop resembling the
// format that was chosen — a 24-game match to soak up an idle court is worse
// than letting a small group finish early — so the stretch is capped and the
// group is allowed to end ahead of the others.
export const MAX_GAMES_STRETCH = 1.5;

export function maxStretchedGames(base: number): number {
  return Math.min(
    MAX_GAMES_PER_MATCH,
    Math.max(base, Math.round(base * MAX_GAMES_STRETCH))
  );
}

// Rounds a round-robin group needs. Odd team counts add a bye round.
export function roundsForGroup(numTeams: number): number {
  if (numTeams < 2) return 0;
  return numTeams % 2 === 0 ? numTeams - 1 : numTeams;
}

// Sequential match slots the group occupies on its own courts.
export function groupSlots(numTeams: number, courts: number): number {
  if (numTeams < 2) return 0;
  const perRound = Math.floor(numTeams / 2);
  return roundsForGroup(numTeams) * Math.ceil(perRound / Math.max(1, courts));
}

export function groupMinutes(
  numTeams: number,
  courts: number,
  games: number
): number {
  return groupSlots(numTeams, courts) * matchMinutes(games);
}

// Picks per-group games_per_match so every group is on court for roughly the
// same wall-clock time. The group needing the most slots (most teams, fewest
// courts) keeps the host's base value and sets the target window; groups that
// would otherwise finish early stretch their matches to fill the same window.
// Balancing time — not match or game count — is deliberate: groups may play a
// different number of matches, they should just finish together.
export function balanceGroupGamesByTime(
  base: number,
  teamsPerGroup: number[],
  courtsPerGroup: number[]
): number[] {
  if (teamsPerGroup.length === 0) return [];
  const slots = teamsPerGroup.map((n, i) =>
    groupSlots(n, courtsPerGroup[i] ?? 1)
  );
  const target = Math.max(0, ...slots.map((s) => s * matchMinutes(base)));
  if (target <= 0) return teamsPerGroup.map(() => base);
  const cap = maxStretchedGames(base);
  return slots.map((s) => {
    if (s <= 0) return base;
    // Grow from the host's base towards the whole match length that lands
    // closest to the slowest group's window, stopping at the stretch cap.
    // Match length is quantised (~4.5 min per extra game), so the nearest fit
    // beats the largest fit — the latter can leave a group 15% short.
    let games = Math.max(1, Math.min(base, cap));
    while (games < cap) {
      const here = Math.abs(target - s * matchMinutes(games));
      const next = Math.abs(target - s * matchMinutes(games + 1));
      if (next >= here) break;
      games++;
    }
    return games;
  });
}

// Longest group's wall-clock minutes — the group stage is done when it is.
export function groupStageMinutes(
  teamsPerGroup: number[],
  courtsPerGroup: number[],
  gamesPerGroup: number[]
): number {
  if (teamsPerGroup.length === 0) return 0;
  return Math.max(
    0,
    ...teamsPerGroup.map((n, i) =>
      groupMinutes(n, courtsPerGroup[i] ?? 1, gamesPerGroup[i] ?? 1)
    )
  );
}
