import type { TournamentMatch } from "./supabase/types";

export const GROUP_PALETTE = [
  {
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    bar: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40",
    panel: "bg-emerald-50/30 dark:bg-emerald-950/10",
  },
  {
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    bar: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900/40",
    panel: "bg-sky-50/30 dark:bg-sky-950/10",
  },
  {
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    bar: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/40",
    panel: "bg-amber-50/30 dark:bg-amber-950/10",
  },
  {
    badge:
      "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    bar: "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900/40",
    panel: "bg-violet-50/30 dark:bg-violet-950/10",
  },
] as const;

export const KNOCKOUT_BADGE =
  "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";

export function buildGroupIndex(
  groups: { id: string }[]
): Map<string, number> {
  const m = new Map<string, number>();
  groups.forEach((g, i) => m.set(g.id, i));
  return m;
}

export function groupPaletteFor(index: number) {
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

export function badgeClassForMatch(
  match: TournamentMatch,
  groupIndex: Map<string, number>
): string {
  if (match.group_id && groupIndex.has(match.group_id)) {
    return groupPaletteFor(groupIndex.get(match.group_id)!).badge;
  }
  return KNOCKOUT_BADGE;
}

export function groupBadgeOrNull(
  match: TournamentMatch,
  groupIndex: Map<string, number>
): string | null {
  if (match.group_id && groupIndex.has(match.group_id)) {
    return groupPaletteFor(groupIndex.get(match.group_id)!).badge;
  }
  return null;
}
