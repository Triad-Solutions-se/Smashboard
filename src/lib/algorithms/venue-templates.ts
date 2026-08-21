// Group layouts and match lengths taken from Bon Padel's own tournament
// templates (MASTER.xlsx, the "N LAG" sheets — 30 gruppspel drawsheets run as
// real events). These beat any formula we could invent: they encode what the
// venue has actually found workable on their courts.
//
// Extraction rules, for when the file is revised:
//   - only gruppspel sheets — sheets whose rule block says "BÄST AV n POÄNG"
//     are Americano, a fixed-length points format this table does not cover
//   - "FÖRST TILL 1 SET" (tiebreak at 5-5) is recorded as 6 games, matching
//     the app's first-to-N model and its "tiebreak vid N-1" label
//   - where several sheets exist for one size, the majority wins; on a tie the
//     plainest-named sheet does (e.g. "10 LAG" over "10 LAG (2)")
//
// Observed range is 4-7 games, never more. That bound is what MAX_BALANCED_GAMES
// in gruppspel.ts enforces on the time balancer.

export type VenueTemplate = { groups: number; games: number };

const TEMPLATES: Record<number, VenueTemplate> = {
  4: { groups: 1, games: 6 },
  6: { groups: 1, games: 6 },
  9: { groups: 2, games: 5 },
  10: { groups: 2, games: 6 },
  12: { groups: 2, games: 5 },
  13: { groups: 2, games: 6 },
  14: { groups: 2, games: 5 },
  16: { groups: 4, games: 6 },
  17: { groups: 4, games: 5 },
  18: { groups: 4, games: 5 },
  19: { groups: 3, games: 6 },
  20: { groups: 4, games: 5 },
  21: { groups: 3, games: 5 },
  28: { groups: 4, games: 5 },
};

/** The venue's own template for this field size, if they have run one. */
export function venueTemplate(teamCount: number): VenueTemplate | null {
  return TEMPLATES[teamCount] ?? null;
}

// Match length for a field size. Exact template if there is one; otherwise the
// nearest sizes on each side, which keeps the 4-7 band and the venue's habit of
// playing longer matches in small fields and shorter ones in big fields.
export function recommendedGames(teamCount: number): number {
  const exact = TEMPLATES[teamCount];
  if (exact) return exact.games;
  const sizes = Object.keys(TEMPLATES).map(Number).sort((a, b) => a - b);
  if (sizes.length === 0) return 5;
  const below = [...sizes].reverse().find((s) => s < teamCount);
  const above = sizes.find((s) => s > teamCount);
  if (below == null) return TEMPLATES[sizes[0]].games;
  if (above == null) return TEMPLATES[sizes[sizes.length - 1]].games;
  const distBelow = teamCount - below;
  const distAbove = above - teamCount;
  if (distBelow < distAbove) return TEMPLATES[below].games;
  if (distAbove < distBelow) return TEMPLATES[above].games;
  // Equidistant: take the shorter match. Overrunning a court booking is worse
  // than finishing early, and neither neighbour is a better claim to accuracy.
  return Math.min(TEMPLATES[below].games, TEMPLATES[above].games);
}
