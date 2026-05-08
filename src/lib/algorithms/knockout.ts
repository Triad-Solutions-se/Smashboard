import type { Court, MatchStage, TournamentMatch } from "../supabase/types";
import type { TeamStanding } from "../standings";

export type GeneratedKOMatch = Omit<TournamentMatch, "id" | "created_at">;

// Returns the smallest power of 2 >= n.
function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Determines the first KO stage given the number of advancing teams.
export function firstKOStage(totalAdvancing: number): MatchStage {
  if (totalAdvancing <= 2) return "final";
  if (totalAdvancing <= 4) return "semi_final";
  return "quarter_final";
}

// Returns the next stage in the bracket progression.
export function nextStage(stage: MatchStage): MatchStage | null {
  switch (stage) {
    case "quarter_final": return "semi_final";
    case "semi_final": return "final";
    case "final": return null;
    case "bronze": return null;
    default: return null;
  }
}

export type GroupStanding = {
  groupId: string;
  groupName: string;
  standings: TeamStanding[];
};

// Letter for bracket index 0 → 'A', 1 → 'B', etc. Caps at 'Z'.
export function bracketLetter(index: number): string {
  return String.fromCharCode(65 + Math.min(25, Math.max(0, index)));
}

export function bracketLabel(letter: string): string {
  return `${letter}-slutspel`;
}

// Number of brackets a tournament should produce: one per advancing rank.
// With ≥2 groups: equals the largest standings.length (i.e. advances_per_group).
// With 1 group: a single combined bracket of all advancing teams.
export function bracketCount(groupStandings: GroupStanding[]): number {
  if (groupStandings.length <= 1) return groupStandings.length === 0 ? 0 : 1;
  return Math.max(...groupStandings.map((g) => g.standings.length));
}

// Splits the host-selected courts across brackets so each bracket runs on its
// own set without competing for the same court. Round-robin distribution gives
// every bracket a court even when courts.length < numBrackets.
function bracketCourts(
  allCourts: Court[],
  bracketIdx: number,
  numBrackets: number
): Court[] {
  if (numBrackets <= 1) return allCourts;
  const filtered = allCourts.filter((_, i) => i % numBrackets === bracketIdx);
  return filtered.length > 0 ? filtered : allCourts;
}

// Generate the first KO round across ALL brackets (A-slutspel, B-slutspel, …).
//
// With ≥2 groups, each bracket contains the rank-N team from every group.
// With 1 group, a single A-slutspel contains all advancing teams (legacy
// single-bracket behavior — there's no other group to pair against).
//
// `byeGroupIds` is kept for API-compatibility but unused (byes are computed
// internally per bracket — top seeds get internal byes when bracket size is
// not a power of two).
export function generateFirstKORound(
  groupStandings: GroupStanding[],
  byeGroupIds: string[],
  courts: Court[],
  tournamentId: string,
  hasBronze: boolean
): GeneratedKOMatch[] {
  void byeGroupIds; // reserved for future host-overridden bye selection
  if (groupStandings.length === 0) return [];

  if (groupStandings.length === 1) {
    // Single-group fallback: all advancing teams form one A-slutspel bracket.
    const sole = groupStandings[0];
    const bracketStandings: GroupStanding[] = [
      { groupId: sole.groupId, groupName: sole.groupName, standings: sole.standings },
    ];
    return generateBracketFirstRound(bracketStandings, courts, tournamentId, hasBronze, "A");
  }

  const brackets = bracketCount(groupStandings);
  const out: GeneratedKOMatch[] = [];
  for (let rank = 0; rank < brackets; rank++) {
    const subStandings: GroupStanding[] = groupStandings
      .map((g) => ({
        groupId: g.groupId,
        groupName: g.groupName,
        standings: rank < g.standings.length ? [g.standings[rank]] : [],
      }))
      .filter((g) => g.standings.length > 0);
    if (subStandings.length < 2) continue; // can't run a 1-team bracket
    const courtsForBracket = bracketCourts(courts, rank, brackets);
    out.push(
      ...generateBracketFirstRound(
        subStandings,
        courtsForBracket,
        tournamentId,
        hasBronze,
        bracketLetter(rank)
      )
    );
  }
  return out;
}

// Generates the first KO round for a SINGLE bracket. `bracketStandings` is a
// list of GroupStandings where each entry's standings array is the slice of
// teams contributing to this bracket. For per-rank brackets that's exactly
// one team per group; for the single-group fallback it's all advancing teams.
function generateBracketFirstRound(
  bracketStandings: GroupStanding[],
  courts: Court[],
  tournamentId: string,
  hasBronze: boolean,
  bracket: string
): GeneratedKOMatch[] {
  const totalAdvancing = bracketStandings.reduce(
    (sum, g) => sum + g.standings.length,
    0
  );
  if (totalAdvancing < 2) return [];

  const stage = firstKOStage(totalAdvancing);
  if (stage === "final") {
    return buildFinalMatches(bracketStandings, courts, tournamentId, bracket);
  }
  if (stage === "semi_final") {
    return buildSFMatches(bracketStandings, courts, tournamentId, bracket);
  }
  return buildQFMatches(bracketStandings, courts, tournamentId, hasBronze, bracket);
}

// 2 teams advancing → straight to Final
function buildFinalMatches(
  bracketStandings: GroupStanding[],
  courts: Court[],
  tournamentId: string,
  bracket: string
): GeneratedKOMatch[] {
  const advancesPerGroup = Math.max(
    ...bracketStandings.map((g) => g.standings.length)
  );
  const seeds = collectSeeds(bracketStandings, advancesPerGroup);
  if (seeds.length < 2) return [];
  const court = courts[0] ?? null;
  return [
    makeMatch(tournamentId, seeds[0].team_id, seeds[1].team_id, "final", court, 1, bracket),
  ];
}

// 3-4 teams advancing → Semi-finals (with possible internal byes)
function buildSFMatches(
  bracketStandings: GroupStanding[],
  courts: Court[],
  tournamentId: string,
  bracket: string
): GeneratedKOMatch[] {
  const matches: GeneratedKOMatch[] = [];
  const totalAdvancing = bracketStandings.reduce((s, g) => s + g.standings.length, 0);
  const bracketSize = nextPowerOf2(totalAdvancing); // always 4 here
  const internalByeCount = bracketSize - totalAdvancing;

  const allTeams = collectSeeds(
    bracketStandings,
    Math.ceil(totalAdvancing / bracketStandings.length)
  );
  const byeTeams = allTeams.slice(0, internalByeCount);
  const byeSet = new Set(byeTeams.map((t) => t.team_id));
  const playingTeams = allTeams.filter((t) => !byeSet.has(t.team_id));

  if (internalByeCount === 0) {
    const court0 = courts[0] ?? null;
    const court1 = courts[1] ?? courts[0] ?? null;
    matches.push(
      makeMatch(tournamentId, allTeams[0].team_id, allTeams[3].team_id, "semi_final", court0, 1, bracket)
    );
    matches.push(
      makeMatch(tournamentId, allTeams[1].team_id, allTeams[2].team_id, "semi_final", court1, 1, bracket)
    );
  } else {
    // Play-in modeled as quarter_final stage; winners feed the SF.
    for (let i = 0; i < playingTeams.length - 1; i += 2) {
      const court = courts[i % Math.max(1, courts.length)] ?? null;
      matches.push(
        makeMatch(
          tournamentId,
          playingTeams[i].team_id,
          playingTeams[i + 1].team_id,
          "quarter_final",
          court,
          1,
          bracket
        )
      );
    }
  }
  return matches;
}

// 5+ teams advancing → Quarter-finals (with possible byes for top seeds)
function buildQFMatches(
  bracketStandings: GroupStanding[],
  courts: Court[],
  tournamentId: string,
  _hasBronze: boolean,
  bracket: string
): GeneratedKOMatch[] {
  const matches: GeneratedKOMatch[] = [];
  const totalAdvancing = bracketStandings.reduce((s, g) => s + g.standings.length, 0);
  const qfSlots = 8;
  const playInMatches = totalAdvancing - qfSlots;
  const internalByeCount = playInMatches < 0 ? -playInMatches : 0;
  const playInCount = playInMatches > 0 ? playInMatches * 2 : 0;

  const allTeams = collectSeeds(
    bracketStandings,
    Math.max(...bracketStandings.map((g) => g.standings.length))
  );

  const byeTeams = allTeams.slice(0, internalByeCount);
  const byeSet = new Set(byeTeams.map((t) => t.team_id));
  const playInTeams = playInCount > 0 ? allTeams.slice(allTeams.length - playInCount) : [];
  const playInSet = new Set(playInTeams.map((t) => t.team_id));
  const playingTeams = allTeams.filter(
    (t) => !byeSet.has(t.team_id) && !playInSet.has(t.team_id)
  );

  if (playInTeams.length > 0) {
    for (let i = 0; i < playInTeams.length - 1; i += 2) {
      const court = courts[i % Math.max(1, courts.length)] ?? null;
      matches.push(
        makeMatch(
          tournamentId,
          playInTeams[i].team_id,
          playInTeams[i + 1].team_id,
          "quarter_final",
          court,
          1,
          bracket
        )
      );
    }
  } else {
    const n = playingTeams.length;
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const court = courts[i % Math.max(1, courts.length)] ?? null;
      matches.push(
        makeMatch(
          tournamentId,
          playingTeams[i].team_id,
          playingTeams[n - 1 - i].team_id,
          "quarter_final",
          court,
          1,
          bracket
        )
      );
    }
  }
  return matches;
}

// Given completed KO matches from the current round of a SINGLE bracket and
// any teams that had byes (advanced without playing this round), generate the
// next round. The new matches inherit the bracket from `completedMatches`.
//
// The host is responsible for partitioning matches by bracket and calling this
// once per bracket; mixing brackets in the same call will tag the new matches
// with the first bracket seen.
export function generateNextKORound(
  completedMatches: TournamentMatch[],
  byeTeamIds: string[],
  courts: Court[],
  tournamentId: string,
  hasBronze: boolean
): GeneratedKOMatch[] {
  if (completedMatches.length === 0 && byeTeamIds.length === 0) return [];
  const bracket = completedMatches[0]?.bracket ?? null;

  const winners = completedMatches.map((m) => {
    const t1Wins = (m.score_team1 ?? 0) > (m.score_team2 ?? 0);
    return t1Wins ? m.team1_id : m.team2_id;
  });
  const losers = completedMatches.map((m) => {
    const t1Wins = (m.score_team1 ?? 0) > (m.score_team2 ?? 0);
    return t1Wins ? m.team2_id : m.team1_id;
  });

  // Bye teams advanced as top seeds; winners are seeded below them.
  const entrants = [...byeTeamIds, ...winners];
  const n = entrants.length;
  if (n < 2) return [];

  const stage: MatchStage = n === 2 ? "final" : n <= 4 ? "semi_final" : "quarter_final";

  const matches: GeneratedKOMatch[] = [];
  const roundNumber = (completedMatches[0]?.round_number ?? 0) + 1;

  for (let i = 0; i < Math.floor(n / 2); i++) {
    const court = courts[i % Math.max(1, courts.length)] ?? null;
    matches.push(
      makeMatch(tournamentId, entrants[i], entrants[n - 1 - i], stage, court, roundNumber, bracket)
    );
  }

  if (hasBronze && stage === "final" && completedMatches.length === 2 && losers.length >= 2) {
    const bronzeCourt = courts[Math.floor(courts.length / 2)] ?? courts[0] ?? null;
    matches.push(
      makeMatch(tournamentId, losers[0], losers[1], "bronze", bronzeCourt, roundNumber, bracket)
    );
  }

  return matches;
}

// Byes are assigned automatically to top seeds — no host selection needed.
export function byeCount(_groupStandings: GroupStanding[]): number {
  return 0;
}

type SeedEntry = { team_id: string; groupId: string; rank: number };

function collectSeeds(groupStandings: GroupStanding[], advancesPerGroup: number): SeedEntry[] {
  const result: SeedEntry[] = [];
  for (let rank = 0; rank < advancesPerGroup; rank++) {
    for (const g of groupStandings) {
      if (rank < g.standings.length) {
        result.push({ team_id: g.standings[rank].team_id, groupId: g.groupId, rank });
      }
    }
  }
  return result;
}

function makeMatch(
  tournamentId: string,
  team1Id: string,
  team2Id: string,
  stage: MatchStage,
  court: Court | null,
  roundNumber: number,
  bracket: string | null
): GeneratedKOMatch {
  return {
    tournament_id: tournamentId,
    group_id: null,
    round_number: roundNumber,
    court_id: court?.id ?? null,
    team1_id: team1Id,
    team2_id: team2Id,
    score_team1: null,
    score_team2: null,
    status: "scheduled",
    stage,
    bracket,
  };
}

// Returns the KO stage label from a set of KO matches in a single bracket.
export function currentKOStage(koMatches: TournamentMatch[]): MatchStage | null {
  const incomplete = koMatches.filter((m) => m.status !== "completed" && m.stage !== "bronze");
  if (incomplete.length > 0) return incomplete[0].stage;
  const complete = koMatches.filter((m) => m.stage !== "bronze");
  if (complete.length > 0) return complete[complete.length - 1].stage;
  return null;
}
