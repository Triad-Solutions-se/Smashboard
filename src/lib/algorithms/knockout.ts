import type { Court, MatchStage, TournamentMatch } from "../supabase/types";
import type { TeamStanding } from "../standings";

export type GeneratedKOMatch = Omit<TournamentMatch, "id" | "created_at">;

// Returns the smallest power of 2 >= n.
function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Standard tennis-draw seed→slot mapping. Returns an array of length B (a power
// of 2) where index i holds the 1-indexed seed assigned to slot i.
//   B=2 → [1,2]
//   B=4 → [1,4,2,3]
//   B=8 → [1,8,4,5,2,7,3,6]
// This keeps top seeds in opposite halves, so they can only meet in later rounds.
export function standardSeedSlots(B: number): number[] {
  if (B < 2 || (B & (B - 1)) !== 0) {
    throw new Error(`standardSeedSlots requires a power of 2 ≥ 2, got ${B}`);
  }
  if (B === 2) return [1, 2];
  const prev = standardSeedSlots(B / 2);
  const out: number[] = [];
  for (const s of prev) {
    out.push(s);
    out.push(B + 1 - s);
  }
  return out;
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

// In single-bracket mode there's just one slutspel — drop the letter prefix.
export function bracketLabelForMode(
  letter: string,
  bracketMode: "single" | "split"
): string {
  return bracketMode === "single" ? "Slutspel" : bracketLabel(letter);
}

// Drops the letter prefix when there is only one bracket. Use this for the
// auto-bracketing flow where multi-bracketness is derived from match data
// rather than from a stored mode.
export function bracketLabelAuto(letter: string, hasMultiple: boolean): string {
  return hasMultiple ? bracketLabel(letter) : "Slutspel";
}

// Auto-derived bracket layout. Returns one entry per bracket holding the team
// count for that bracket. Rule:
//   - totalAdvancing < 2 → []
//   - totalAdvancing % 8 === 0 AND totalAdvancing >= 16 → N brackets of 8
//     (A-slutspel, B-slutspel, … each a clean QF)
//   - otherwise → a single bracket with all advancing teams
//
// The "8-clean-multiple" rule keeps splits predictable: hosts never end up
// with an awkward 7-team or 9-team A-bracket alongside a 1-team B-bracket.
export function autoBracketSizes(totalAdvancing: number): number[] {
  if (totalAdvancing < 2) return [];
  if (totalAdvancing >= 16 && totalAdvancing % 8 === 0) {
    return new Array(totalAdvancing / 8).fill(8);
  }
  return [totalAdvancing];
}

// Per-bracket seed-ordered team IDs under the auto-bracket rule.
// Both single- and multi-bracket cases use (rank, group order) via
// `collectSeeds`. Group label decides seed position within a rank tier — GF/GD
// is ignored so the bracket structure is fully deterministic from the standings
// layout. Multi-bracket simply slices the rank-major list into 8-team chunks
// (top 8 → A, next 8 → B, …); `qualified` is accepted for API compatibility
// but unused.
export function autoBracketSeedOrders(
  groupStandings: GroupStanding[],
  qualified: QualifiedTeam[]
): Map<string, string[]> {
  void qualified;
  const totalAdvancing = groupStandings.reduce(
    (s, g) => s + g.standings.length,
    0
  );
  const sizes = autoBracketSizes(totalAdvancing);
  const out = new Map<string, string[]>();
  if (sizes.length === 0) return out;

  const apg = Math.max(0, ...groupStandings.map((g) => g.standings.length));
  if (apg === 0) return out;
  const allSeeds = collectSeeds(groupStandings, apg).map((s) => s.team_id);

  if (sizes.length === 1) {
    out.set("A", allSeeds);
    return out;
  }

  let offset = 0;
  for (let bi = 0; bi < sizes.length; bi++) {
    const size = sizes[bi];
    out.set(bracketLetter(bi), allSeeds.slice(offset, offset + size));
    offset += size;
  }
  return out;
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
//
// Pass `formation: "seeded"` (plus `qualifiedTeams`) to generate one unified
// tennis-draw-seeded bracket instead. See `generateSeededFirstRound`.
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

// Resolves a KO match to its winner/loser. Returns null when the result is
// unusable for advancement: missing scores or a tie. A KO match cannot end in
// a draw — the host must adjust the score before the bracket can progress.
export function getKOWinnerId(m: TournamentMatch): string | null {
  if (m.score_team1 == null || m.score_team2 == null) return null;
  if (m.score_team1 === m.score_team2) return null;
  return m.score_team1 > m.score_team2 ? m.team1_id : m.team2_id;
}

export function getKOLoserId(m: TournamentMatch): string | null {
  if (m.score_team1 == null || m.score_team2 == null) return null;
  if (m.score_team1 === m.score_team2) return null;
  return m.score_team1 > m.score_team2 ? m.team2_id : m.team1_id;
}

// Thrown when generateNextKORound is called with at least one tied or
// unscored KO match. Callers should catch this and surface it to the host so
// the score can be corrected before retrying.
export class KOTieError extends Error {
  constructor(public readonly match: TournamentMatch) {
    const detail =
      match.score_team1 == null || match.score_team2 == null
        ? "saknar resultat"
        : `lika resultat ${match.score_team1}–${match.score_team2}`;
    super(`Slutspelsmatchen kan inte avgöras: ${detail}`);
    this.name = "KOTieError";
  }
}

// Given completed KO matches from the current round of a SINGLE bracket and
// any teams that had byes (advanced without playing this round), generate the
// next round. The new matches inherit the bracket from `completedMatches`.
//
// The host is responsible for partitioning matches by bracket and calling this
// once per bracket; mixing brackets in the same call will tag the new matches
// with the first bracket seen.
//
// Throws KOTieError if any completed match is tied or missing a score — the
// bracket cannot advance silently past an ambiguous result.
export function generateNextKORound(
  completedMatches: TournamentMatch[],
  byeTeamIds: string[],
  courts: Court[],
  tournamentId: string,
  hasBronze: boolean
): GeneratedKOMatch[] {
  if (completedMatches.length === 0 && byeTeamIds.length === 0) return [];
  const bracket = completedMatches[0]?.bracket ?? null;

  const winners: string[] = [];
  const losers: string[] = [];
  for (const m of completedMatches) {
    const w = getKOWinnerId(m);
    const l = getKOLoserId(m);
    if (w == null || l == null) throw new KOTieError(m);
    winners.push(w);
    losers.push(l);
  }

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

export type SeedEntry = { team_id: string; groupId: string; rank: number };

// Collects qualifying teams in (rank-major, group-order) order so the resulting
// seed list maps directly into a tennis bracket: seed N = the N-th entry. This
// is what places G1R1 vs G_lastR2, G2R1 vs G_(last-1)R2, etc. when fed through
// standardSeedSlots.
export function collectSeeds(groupStandings: GroupStanding[], advancesPerGroup: number): SeedEntry[] {
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

// ---------------------------------------------------------------------------
// Seeded (cross-group) bracket — single unified bracket
// ---------------------------------------------------------------------------

// Input shape for the seeded path. Each entry is one qualifying team with the
// info needed to compute an overall seed.
export type QualifiedTeam = {
  team_id: string;
  groupId: string;
  // 0-based rank within the team's group (0 = group winner). Used as the
  // primary tier when no manual seed is given.
  rank: number;
  // Manual seed override from `tournament_teams.seed` (1-indexed, 1 = best).
  manualSeed: number | null;
  // Standings tiebreakers, only consulted when manual seed is absent.
  gf: number;
  gd: number;
  ga: number;
};

// Computes the overall seed order from a flat list of qualified teams.
//
// Rules:
//   1. Teams with a manual seed sort first, by manualSeed asc.
//   2. Remaining teams sort by (rank asc, GF desc, GD desc, GA asc, team_id asc).
// The returned array index + 1 is the 1-indexed overall seed.
export function computeSeedOrder(qualified: QualifiedTeam[]): QualifiedTeam[] {
  return [...qualified].sort((a, b) => {
    const am = a.manualSeed;
    const bm = b.manualSeed;
    if (am != null && bm != null) return am - bm;
    if (am != null) return -1;
    if (bm != null) return 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.gf !== b.gf) return b.gf - a.gf;
    if (a.gd !== b.gd) return b.gd - a.gd;
    if (a.ga !== b.ga) return a.ga - b.ga;
    return a.team_id.localeCompare(b.team_id);
  });
}

// Builds the slot array for a seeded bracket. Returns length B = nextPow2(N),
// where each slot holds a team_id or null (BYE). Slot positions follow
// `standardSeedSlots`, so seed S goes to slot where standardSeedSlots(B)[i] === S.
export function buildBracketSlots(
  seedOrderedTeamIds: string[]
): (string | null)[] {
  const N = seedOrderedTeamIds.length;
  if (N < 2) return seedOrderedTeamIds.slice();
  const B = nextPowerOf2(N);
  const slotSeeds = standardSeedSlots(B);
  const slots: (string | null)[] = new Array(B).fill(null);
  for (let i = 0; i < B; i++) {
    const seed = slotSeeds[i]; // 1-indexed
    slots[i] = seed <= N ? seedOrderedTeamIds[seed - 1] : null;
  }
  return slots;
}

// Stage selector for a seeded bracket of M pair-entrants going into the next
// round. M = bracketSize / 2 after round 1, M / 2 after each subsequent round.
function seededStageForRound(m: number): MatchStage {
  if (m <= 2) return "final";
  if (m <= 4) return "semi_final";
  return "quarter_final";
}

// Anti-rematch swap: scans paired-up first-round matches and, for any pair with
// both teams in the same group, swaps one of the teams with a team in the
// opposite half of the bracket whose swap resolves the conflict without
// creating a new one. Operates in-place on the slot array.
function applyAntiRematchSwap(
  slots: (string | null)[],
  groupIdByTeam: Map<string, string>
): void {
  const B = slots.length;
  if (B < 4) return;
  const halfSize = B / 2;
  // For each pair (2i, 2i+1), if same group, try swapping the slot at 2i+1
  // with a slot in the opposite half that fixes it.
  for (let i = 0; i < B; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a || !b) continue;
    const ga = groupIdByTeam.get(a);
    const gb = groupIdByTeam.get(b);
    if (!ga || !gb || ga !== gb) continue;

    // Find a candidate slot in the opposite half whose teams have different groups
    // from both the current pair and the candidate's existing pair.
    const oppStart = i < halfSize ? halfSize : 0;
    const oppEnd = oppStart + halfSize;
    let swapped = false;
    for (let j = oppStart; j < oppEnd; j++) {
      const cand = slots[j];
      if (!cand) continue;
      const candGroup = groupIdByTeam.get(cand);
      if (!candGroup) continue;
      // candidate's pair sibling
      const sibIdx = j % 2 === 0 ? j + 1 : j - 1;
      const sib = slots[sibIdx];
      const sibGroup = sib ? groupIdByTeam.get(sib) : null;
      // Swap b ↔ cand. After swap:
      //   new pair (a, cand): groups (ga, candGroup) — must differ
      //   new pair (sib, b): groups (sibGroup, gb) — must differ (or sib is null)
      if (candGroup === ga) continue;
      if (sibGroup && sibGroup === gb) continue;
      slots[i + 1] = cand;
      slots[j] = b;
      swapped = true;
      break;
    }
    if (!swapped) {
      // Best-effort: leave the rematch in place rather than break the bracket.
      // Hosts can manually re-seed if this matters.
    }
  }
}

// Generates round 1 of a seeded bracket. Returns matches in pair-index order,
// skipping pairs where one slot is a BYE (those teams advance automatically).
// Callers can recover the pair-index of byes via `computeSeededByePairIndices`.
export function generateSeededFirstRound(
  qualified: QualifiedTeam[],
  courts: Court[],
  tournamentId: string,
  bracket: string | null = null
): GeneratedKOMatch[] {
  if (qualified.length < 2) return [];
  const seedOrder = computeSeedOrder(qualified);
  const seedOrderedIds = seedOrder.map((q) => q.team_id);
  const slots = buildBracketSlots(seedOrderedIds);
  const groupIdByTeam = new Map<string, string>();
  for (const q of qualified) groupIdByTeam.set(q.team_id, q.groupId);
  applyAntiRematchSwap(slots, groupIdByTeam);

  const B = slots.length;
  const pairCount = B / 2;
  // Stage follows bracket position, not match count — a 4-slot round is always
  // SF even if there's only one real match (the other being a bye).
  const stage = seededStageForRound(B);
  const matches: GeneratedKOMatch[] = [];
  let courtIdx = 0;
  for (let p = 0; p < pairCount; p++) {
    const a = slots[2 * p];
    const b = slots[2 * p + 1];
    if (!a || !b) continue; // BYE pair — the non-null team auto-advances
    const court = courts.length > 0 ? courts[courtIdx % courts.length] : null;
    courtIdx++;
    matches.push(makeMatch(tournamentId, a, b, stage, court, 1, bracket));
  }
  return matches;
}

// Generates round 1 of a SINGLE unified bracket where seed N = the N-th team
// in (rank-major, group-order). With 4 groups × 2 advancing this produces
// standard tennis pairings: G1R1 vs G4R2, G4R1 vs G1R2, G2R1 vs G3R2, G3R1 vs
// G2R2. The bracket label is "A" for storage compatibility — UI hides the
// letter when bracket_mode === "single".
export function generateSingleBracketFirstRound(
  groupStandings: GroupStanding[],
  courts: Court[],
  tournamentId: string
): GeneratedKOMatch[] {
  const advancesPerGroup = Math.max(
    0,
    ...groupStandings.map((g) => g.standings.length)
  );
  if (advancesPerGroup === 0) return [];
  const seeds = collectSeeds(groupStandings, advancesPerGroup);
  if (seeds.length < 2) return [];
  const seedOrderedIds = seeds.map((s) => s.team_id);
  const slots = buildBracketSlots(seedOrderedIds);
  const groupIdByTeam = new Map<string, string>();
  for (const s of seeds) groupIdByTeam.set(s.team_id, s.groupId);
  applyAntiRematchSwap(slots, groupIdByTeam);

  const B = slots.length;
  const stage = seededStageForRound(B);
  const matches: GeneratedKOMatch[] = [];
  let courtIdx = 0;
  for (let p = 0; p < B / 2; p++) {
    const a = slots[2 * p];
    const b = slots[2 * p + 1];
    if (!a || !b) continue; // BYE pair — the non-null team auto-advances
    const court = courts.length > 0 ? courts[courtIdx % courts.length] : null;
    courtIdx++;
    matches.push(makeMatch(tournamentId, a, b, stage, court, 1, "A"));
  }
  return matches;
}

// Auto-bracket first-round generator. Replaces the legacy host-picked
// "single" vs "split" choice — the layout falls out of the team count:
//   - sizes.length === 1 → delegate to `generateSingleBracketFirstRound`
//     (existing single-bracket behaviour, possibly QF with internal byes).
//   - sizes.length > 1   → emit one 8-team QF bracket per slice. The rank-major
//     group-major seed list (G1R1, G2R1, …, G1R2, G2R2, …) is chunked into
//     8-team slices: top 8 → A-slutspel, next 8 → B-slutspel, etc. Within a
//     bracket, standard tennis seeding (1v8, 4v5, 2v7, 3v6) places opposite
//     groups in opposite halves. Pairings are deterministic from the group
//     standings layout — GF/GD does NOT re-seed.
//
// `qualified` is accepted for API compatibility but unused: the per-team
// standings already arrive in the order chosen by `gruppspel.ts`.
export function generateAutoFirstRound(
  groupStandings: GroupStanding[],
  qualified: QualifiedTeam[],
  courts: Court[],
  tournamentId: string
): GeneratedKOMatch[] {
  void qualified;
  const totalAdvancing = groupStandings.reduce(
    (s, g) => s + g.standings.length,
    0
  );
  const sizes = autoBracketSizes(totalAdvancing);
  if (sizes.length === 0) return [];

  if (sizes.length === 1) {
    return generateSingleBracketFirstRound(groupStandings, courts, tournamentId);
  }

  const apg = Math.max(0, ...groupStandings.map((g) => g.standings.length));
  if (apg === 0) return [];
  const allSeeds = collectSeeds(groupStandings, apg);
  const groupIdByTeam = new Map<string, string>();
  for (const s of allSeeds) groupIdByTeam.set(s.team_id, s.groupId);

  const out: GeneratedKOMatch[] = [];
  let offset = 0;
  for (let bi = 0; bi < sizes.length; bi++) {
    const size = sizes[bi];
    const chunkIds = allSeeds.slice(offset, offset + size).map((s) => s.team_id);
    offset += size;
    if (chunkIds.length < 2) continue;

    const slots = buildBracketSlots(chunkIds);
    applyAntiRematchSwap(slots, groupIdByTeam);

    const bracketCourtList = bracketCourts(courts, bi, sizes.length);
    const B = slots.length;
    const stage = seededStageForRound(B);
    const letter = bracketLetter(bi);
    let courtIdx = 0;
    for (let p = 0; p < B / 2; p++) {
      const a = slots[2 * p];
      const b = slots[2 * p + 1];
      if (!a || !b) continue;
      const court =
        bracketCourtList.length > 0
          ? bracketCourtList[courtIdx % bracketCourtList.length]
          : null;
      courtIdx++;
      out.push(makeMatch(tournamentId, a, b, stage, court, 1, letter));
    }
  }
  return out;
}

// Returns the pair-index (0-based) of each bye team in seed order, given the
// flat seed-ordered list of qualifying team_ids. A "bye" is a top seed whose
// slot pair contained a BYE marker. Pair indices are sorted ascending.
export function computeSeededByePairIndices(
  seedOrderedTeamIds: string[]
): { teamId: string; pairIndex: number }[] {
  const N = seedOrderedTeamIds.length;
  if (N < 2) return [];
  const B = nextPowerOf2(N);
  if (B === N) return [];
  const slotSeeds = standardSeedSlots(B);
  // Map seed → slot index
  const slotOf = new Map<number, number>();
  for (let i = 0; i < B; i++) slotOf.set(slotSeeds[i], i);
  const out: { teamId: string; pairIndex: number }[] = [];
  for (let seed = N + 1; seed <= B; seed++) {
    const byeSlot = slotOf.get(seed)!;
    // sibling slot
    const sibSlot = byeSlot ^ 1;
    const sibSeed = slotSeeds[sibSlot];
    if (sibSeed > N) continue; // both BYE — shouldn't happen with top-seed bye allocation
    out.push({
      teamId: seedOrderedTeamIds[sibSeed - 1],
      pairIndex: byeSlot >> 1,
    });
  }
  return out.sort((a, b) => a.pairIndex - b.pairIndex);
}

// Generates the next round of a seeded bracket. `pairEntrants` is the
// pair-index-ordered list of teams entering this round (length M = prior-round
// pair count). Adjacent pairs become matches; the host is responsible for
// preserving pair order across rounds.
export function generateSeededNextRound(
  pairEntrants: string[],
  courts: Court[],
  tournamentId: string,
  hasBronze: boolean,
  losersForBronze: [string, string] | null,
  roundNumber: number,
  bracket: string | null = null
): GeneratedKOMatch[] {
  const M = pairEntrants.length;
  if (M < 2) return [];
  const stage = seededStageForRound(M);
  const matches: GeneratedKOMatch[] = [];
  let courtIdx = 0;
  for (let i = 0; i < M; i += 2) {
    const a = pairEntrants[i];
    const b = pairEntrants[i + 1];
    if (!a || !b) continue;
    const court = courts.length > 0 ? courts[courtIdx % courts.length] : null;
    courtIdx++;
    matches.push(makeMatch(tournamentId, a, b, stage, court, roundNumber, bracket));
  }
  if (hasBronze && stage === "final" && losersForBronze) {
    const bronzeCourt =
      courts[Math.floor(courts.length / 2)] ?? courts[0] ?? null;
    matches.push(
      makeMatch(
        tournamentId,
        losersForBronze[0],
        losersForBronze[1],
        "bronze",
        bronzeCourt,
        roundNumber,
        bracket
      )
    );
  }
  return matches;
}

// Returns the KO stage label from a set of KO matches in a single bracket.
export function currentKOStage(koMatches: TournamentMatch[]): MatchStage | null {
  const incomplete = koMatches.filter((m) => m.status !== "completed" && m.stage !== "bronze");
  if (incomplete.length > 0) return incomplete[0].stage;
  const complete = koMatches.filter((m) => m.stage !== "bronze");
  if (complete.length > 0) return complete[complete.length - 1].stage;
  return null;
}
