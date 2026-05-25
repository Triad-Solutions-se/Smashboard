"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Tenant,
  Tournament,
  TournamentTeam,
  Court,
  Player,
} from "@/lib/supabase/types";
import {
  updateDraftTeam,
  deleteDraftTeam,
  resetTournamentGroupData,
  insertGroups,
  insertMatches,
  insertRoundRests,
  assignTeamGroup,
  activateTournament,
} from "@/lib/db/tournaments";
import {
  generateGroupMatches,
  totalRoundsFor,
} from "@/lib/algorithms/gruppspel";
import { autoBracketSizes } from "@/lib/algorithms/knockout";
import { PlayerCombobox } from "@/components/PlayerCombobox";

// Per-stage match counts across all auto-generated brackets.
// Stage labels match the DB: play-in rounds are stored under `quarter_final`,
// and n=3 SF play-ins are still labeled "Semifinal" for display purposes.
function playoffMatchCounts(
  totalAdvancing: number,
  hasBronze: boolean,
): { qf: number; sf: number; final: number } {
  const sizes = autoBracketSizes(totalAdvancing);
  let qf = 0;
  let sf = 0;
  let final = 0;
  for (const n of sizes) {
    if (n < 2) continue;
    if (n === 2) {
      final += 1;
    } else if (n <= 4) {
      sf += n === 3 ? 1 : 2;
      final += 1;
    } else {
      qf += n - 4;
      sf += 2;
      final += 1;
    }
  }
  if (hasBronze) final += sizes.length;
  return { qf, sf, final };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Preset = { groups: number; advances: number };

type TimeEstimate = {
  matchMinutes: number;
  groupMinutes: number;
  playoffMinutes: number;
  totalMinutes: number;
};

// Round-robin matches-per-team for a group of size n. Even n: every team plays
// every round so n-1 matches; odd n: one bye per team across n rounds → still
// n-1 matches played per team. Used to balance per-group games_per_match so
// each player gets roughly the same total games regardless of group size.
function matchesPerTeamFor(n: number): number {
  return Math.max(1, n - 1);
}

// Auto-balance per-group games_per_match so total game count per player stays
// roughly equal across groups. The biggest group keeps the base value; smaller
// groups (fewer matches per team) get longer matches.
function autoBalanceGroupGames(base: number, teamsPerGroup: number[]): number[] {
  if (teamsPerGroup.length === 0) return [];
  const mpt = teamsPerGroup.map(matchesPerTeamFor);
  const maxMpt = Math.max(...mpt);
  const targetTotal = maxMpt * base;
  return mpt.map((m) => Math.max(1, Math.round(targetTotal / m)));
}

function estimateTournamentTime(
  fullTeamCount: number,
  numGroups: number,
  advancesPerGroup: number,
  hasBronze: boolean,
  groupGamesPerMatch: number[],
  activeCourts: number,
): TimeEstimate {
  const baseGames = groupGamesPerMatch[0] ?? 5;
  const matchMinutes = baseGames * 3 + 5;
  const zero = { matchMinutes, groupMinutes: 0, playoffMinutes: 0, totalMinutes: 0 };

  if (fullTeamCount < 2 || numGroups < 1 || activeCourts < 1) return zero;

  const teamsPerGroup = Math.floor(fullTeamCount / numGroups);
  if (teamsPerGroup < 2) return zero;

  const roundsPerGroup = teamsPerGroup % 2 === 0 ? teamsPerGroup - 1 : teamsPerGroup;
  const matchesPerRoundPerGroup = Math.floor(teamsPerGroup / 2);
  const courtsPerGroup = Math.max(1, Math.floor(activeCourts / numGroups));
  const slotsPerRound = Math.ceil(matchesPerRoundPerGroup / courtsPerGroup);

  // Sum each group's wall-clock minutes using its own games_per_match.
  let groupMinutes = 0;
  for (let i = 0; i < numGroups; i++) {
    const g = groupGamesPerMatch[i] ?? baseGames;
    const perMatch = g * 3 + 5;
    groupMinutes = Math.max(groupMinutes, roundsPerGroup * slotsPerRound * perMatch);
  }

  // Playoffs use the longest game length (= the "base" KO target).
  const playoffGames = Math.max(...groupGamesPerMatch, baseGames);
  const playoffMinPerMatch = playoffGames * 3 + 5;
  let playoffMinutes = 0;
  if (advancesPerGroup > 0) {
    const totalAdvancing = advancesPerGroup * numGroups;
    const { qf, sf, final } = playoffMatchCounts(totalAdvancing, hasBronze);
    if (qf > 0) playoffMinutes += Math.ceil(qf / activeCourts) * playoffMinPerMatch;
    if (sf > 0) playoffMinutes += Math.ceil(sf / activeCourts) * playoffMinPerMatch;
    if (final > 0) playoffMinutes += Math.ceil(final / activeCourts) * playoffMinPerMatch;
  }

  return { matchMinutes, groupMinutes, playoffMinutes, totalMinutes: groupMinutes + playoffMinutes };
}

function fmtTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function getPresets(n: number): Preset[] {
  const out: Preset[] = [];
  if (n < 4) return out;

  const feasible = (g: number, a: number) =>
    g >= 1 && a >= 1 && g <= n && a <= Math.floor(n / g);

  // Presets that produce a clean 8-team QF (or multiples thereof, splitting
  // into A/B/C-slutspel automatically) are surfaced first since they're the
  // standard padel format.

  // 8 teams: 4 groups × 2 → 8-team QF
  if (n >= 8 && feasible(4, 2)) out.push({ groups: 4, advances: 2 });

  // 16+ teams: 8 groups × 2 → 16 advancing → A/B-QF brackets
  if (n >= 16 && feasible(8, 2)) out.push({ groups: 8, advances: 2 });

  // 16+ teams: 4 groups × 4 → 16 advancing → A/B-QF brackets
  if (n >= 16 && feasible(4, 4)) out.push({ groups: 4, advances: 4 });

  // 24+ teams: 8 groups × 3 → 24 advancing → A/B/C-QF brackets
  if (n >= 24 && feasible(8, 3)) out.push({ groups: 8, advances: 3 });

  // Smaller-field fallbacks (single SF/Final brackets) for tournaments
  // where 8-team QF doesn't fit.

  // 4-5 teams: 2 groups × 1 → 2-team Final
  if (n <= 5 && feasible(2, 1)) out.push({ groups: 2, advances: 1 });

  // 6-8 teams: 2 groups × 2 → 4-team SF
  if (n >= 6 && n <= 10 && feasible(2, 2)) out.push({ groups: 2, advances: 2 });

  // 9-12 teams: 3 groups × 2 → 6-team SF (with byes)
  if (n >= 9 && n <= 12 && feasible(3, 2)) out.push({ groups: 3, advances: 2 });

  // 21+ teams: 6 groups × 2 → 12-team QF (with byes/play-ins, one bracket)
  if (n >= 21 && feasible(6, 2)) out.push({ groups: 6, advances: 2 });

  // Deduplicate by (groups, advances) preserving order — earlier wins so the
  // QF-bracket presets stay at the front.
  return out.filter(
    (p, i, arr) => arr.findIndex((q) => q.groups === p.groups && q.advances === p.advances) === i
  );
}

function stageLabel(total: number): string {
  if (total <= 2) return "Final";
  if (total <= 4) return "SF → Final";
  return "QF → SF → Final";
}

export function StartView({
  tenant,
  tournament,
  initialTeams,
  courts,
  players,
}: {
  tenant: Tenant;
  tournament: Tournament;
  initialTeams: TournamentTeam[];
  courts: Court[];
  players: Player[];
}) {
  const router = useRouter();
  const accent = tenant.primary_color || "#10b981";

  const playerMap = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  // Local pairing state — we apply changes on submit.
  const [teams, setTeams] = useState<TournamentTeam[]>(initialTeams);
  const [pairing, setPairing] = useState<Record<string, string | null>>(() => {
    const p: Record<string, string | null> = {};
    for (const t of initialTeams) {
      if (!t.player2_id) p[t.id] = null;
    }
    return p;
  });

  const [numGroups, setNumGroups] = useState(2);
  const [baseGamesPerMatch, setBaseGamesPerMatch] = useState(5);
  // Per-group games_per_match. Index = group sort_order (0..numGroups-1).
  // Auto-balanced from baseGamesPerMatch + actual teams-per-group so each
  // player gets roughly the same total games. Cells the host edits manually
  // are sticky (tracked in touchedGroups) and survive rebalance passes.
  const [groupGames, setGroupGames] = useState<number[]>([5, 5]);
  const [touchedGroups, setTouchedGroups] = useState<Set<number>>(new Set());
  const [advancesPerGroup, setAdvancesPerGroup] = useState(0);
  const [hasBronze, setHasBronze] = useState(false);
  const [lottning, setLottning] = useState<"automatic" | "manual">("automatic");
  const [selectedCourts, setSelectedCourts] = useState<Set<string>>(
    new Set<string>()
  );
  const [qfCourtIds, setQfCourtIds] = useState<Set<string>>(new Set());
  const [sfCourtIds, setSfCourtIds] = useState<Set<string>>(new Set());
  const [finalCourtIds, setFinalCourtIds] = useState<Set<string>>(new Set());
  // Per-court group index (which group plays on this court). Default: round-robin
  // across the initial numGroups so each group gets at least one court out of the
  // box. Stays in sync as numGroups changes via the clamp effect below.
  const [courtGroupIdx, setCourtGroupIdx] = useState<Record<string, number>>(
    () => {
      const m: Record<string, number> = {};
      courts.forEach((c, i) => {
        m[c.id] = i % 2;
      });
      return m;
    }
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto pre-assign courts to groups when the host picks a group count.
  // Fires on mount and whenever numGroups changes; ignores fullTeamCount
  // changes so a host can pair a solo team without losing manual court edits.
  const prevNumGroupsRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevNumGroupsRef.current === numGroups) return;
    prevNumGroupsRef.current = numGroups;
    if (courts.length === 0 || numGroups < 1) return;

    const newSelected = new Set<string>();
    const newCourtGroup: Record<string, number> = {};
    let courtIdx = 0;
    for (let g = 0; g < numGroups; g++) {
      const want = suggestedCourtsPerGroup[g] ?? 1;
      for (let c = 0; c < want && courtIdx < courts.length; c++) {
        const court = courts[courtIdx];
        newSelected.add(court.id);
        newCourtGroup[court.id] = g;
        courtIdx++;
      }
    }
    while (courtIdx < courts.length) {
      newCourtGroup[courts[courtIdx].id] = courtIdx % numGroups;
      courtIdx++;
    }
    setSelectedCourts(newSelected);
    setCourtGroupIdx(newCourtGroup);
    // suggestedCourtsPerGroup is read but intentionally not in deps —
    // it changes with fullTeamCount, and we only want numGroups changes
    // to trigger a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numGroups, courts]);

  const soloTeams = teams.filter((t) => !t.player2_id);

  const allUsed = useMemo(() => {
    const s = new Set<string>();
    for (const t of teams) {
      s.add(t.player1_id);
      if (t.player2_id) s.add(t.player2_id);
    }
    for (const v of Object.values(pairing)) {
      if (v) s.add(v);
    }
    return s;
  }, [teams, pairing]);

  const availableForPairing = useMemo(
    () => players.filter((p) => p.active && !allUsed.has(p.id)),
    [players, allUsed]
  );

  const allPaired = soloTeams.every(
    (t) => pairing[t.id] && pairing[t.id]!.length > 0
  );

  const formatSupported = tournament.format === "gruppspel";

  const teamsAfterPairing = useMemo(() => {
    return teams.map((t) => {
      if (t.player2_id) return t;
      const v = pairing[t.id];
      return v ? { ...t, player2_id: v } : t;
    });
  }, [teams, pairing]);

  const fullTeamCount = teamsAfterPairing.filter(
    (t) => !!t.player2_id
  ).length;

  const groupCourtCounts = useMemo(() => {
    const counts = Array<number>(numGroups).fill(0);
    for (const id of selectedCourts) {
      const g = courtGroupIdx[id];
      if (g !== undefined && g < numGroups) counts[g]++;
    }
    return counts;
  }, [selectedCourts, courtGroupIdx, numGroups]);
  const allGroupsHaveCourts = groupCourtCounts.every((c) => c >= 1);

  // Per-group team counts mirror the round-robin distribution at submit
  // (shuffle then i % groupCount): the first `n%g` groups get one extra team.
  const teamsPerGroupArray = useMemo(() => {
    if (fullTeamCount < 1 || numGroups < 1) return [];
    const base = Math.floor(fullTeamCount / numGroups);
    const remainder = fullTeamCount % numGroups;
    return Array.from({ length: numGroups }, (_, i) =>
      base + (i < remainder ? 1 : 0)
    );
  }, [fullTeamCount, numGroups]);
  const suggestedCourtsPerGroup = useMemo(
    () => teamsPerGroupArray.map((n) => Math.max(1, Math.floor(n / 2))),
    [teamsPerGroupArray]
  );
  const suggestedTotalCourts = useMemo(
    () =>
      suggestedCourtsPerGroup.length === 0
        ? 1
        : suggestedCourtsPerGroup.reduce((a, b) => a + b, 0),
    [suggestedCourtsPerGroup]
  );

  // Rebalance groupGames whenever the base value or per-group team counts
  // shift. Cells the host has touched stay put; auto-derived cells follow.
  useEffect(() => {
    setGroupGames((prev) => {
      const auto = autoBalanceGroupGames(
        baseGamesPerMatch,
        teamsPerGroupArray.length > 0 ? teamsPerGroupArray : Array(numGroups).fill(2)
      );
      const next: number[] = [];
      for (let i = 0; i < numGroups; i++) {
        if (touchedGroups.has(i) && prev[i] != null) next.push(prev[i]);
        else next.push(auto[i] ?? baseGamesPerMatch);
      }
      return next;
    });
  }, [baseGamesPerMatch, teamsPerGroupArray, numGroups, touchedGroups]);

  // Group count changes invalidate manual overrides (group identities shift).
  useEffect(() => {
    setTouchedGroups(new Set());
  }, [numGroups]);

  // The "tournament-level" games_per_match acts as the fallback used by KO
  // matches and any UI without a group context. Use the max so playoff matches
  // have at least as much room as the longest group match.
  const tournamentGamesPerMatch = useMemo(
    () => (groupGames.length > 0 ? Math.max(...groupGames) : baseGamesPerMatch),
    [groupGames, baseGamesPerMatch]
  );

  // Use selected courts if any; fall back to the suggested count for estimates
  // before the host has picked courts.
  const activeCourtsForEstimate = selectedCourts.size > 0 ? selectedCourts.size : suggestedTotalCourts;
  const estimate = estimateTournamentTime(
    fullTeamCount,
    numGroups,
    advancesPerGroup,
    hasBronze,
    groupGames,
    Math.max(1, activeCourtsForEstimate),
  );

  const allGamesValid = groupGames.every((g) => g >= 1);
  const canSubmit =
    formatSupported &&
    fullTeamCount >= 2 &&
    allPaired &&
    selectedCourts.size >= 1 &&
    allGroupsHaveCourts &&
    allGamesValid &&
    baseGamesPerMatch >= 1 &&
    numGroups >= 1 &&
    fullTeamCount >= numGroups;

  function setGroupGameAt(idx: number, value: number) {
    setGroupGames((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
    setTouchedGroups((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }

  function toggleCourt(id: string) {
    setSelectedCourts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setCourtGroup(id: string, g: number) {
    setCourtGroupIdx((prev) => ({ ...prev, [id]: g }));
  }

  async function dropSolo(teamId: string) {
    setErr(null);
    try {
      await deleteDraftTeam(teamId);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setPairing((prev) => {
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setErr(null);
    setSubmitting(true);
    try {
      if (lottning === "manual") {
        // Hand off to /draw, which finishes the activation after the host
        // has dragged each team into a group. In manual mode the host hasn't
        // placed teams yet, so we pass the base value and let /draw rebalance
        // per-group from the actual placement.
        sessionStorage.setItem(
          `draw-${tournament.id}`,
          JSON.stringify({
            numGroups,
            gamesPerMatch: baseGamesPerMatch,
            advancesPerGroup,
            hasBronze,
            selectedCourts: [...selectedCourts],
            courtGroupIdx,
            qfCourtIds: [...qfCourtIds],
            sfCourtIds: [...sfCourtIds],
            finalCourtIds: [...finalCourtIds],
            pairing,
          })
        );
        router.push(`/${tenant.slug}/tournament/${tournament.id}/draw`);
        return;
      }

      // 0. Wipe any stale groups/matches from a previous failed submission.
      await resetTournamentGroupData(tournament.id);

      // 1. Apply pairings to solo teams.
      const pairedUpdates = soloTeams
        .map((t) => ({ id: t.id, player2_id: pairing[t.id]! }))
        .filter((x) => x.player2_id);
      for (const u of pairedUpdates) {
        const team = teams.find((t) => t.id === u.id);
        if (!team) continue;
        await updateDraftTeam(u.id, {
          player1_id: team.player1_id,
          player2_id: u.player2_id,
        });
      }

      // 2. Distribute teams across groups by shuffling and round-robining
      //    into buckets.
      const fullTeams: TournamentTeam[] = teamsAfterPairing.filter(
        (t): t is TournamentTeam => !!t.player2_id
      );
      const groupCount = Math.min(numGroups, fullTeams.length);
      const buckets: TournamentTeam[][] = Array.from(
        { length: groupCount },
        () => []
      );
      shuffle(fullTeams).forEach((t, i) => {
        buckets[i % groupCount].push(t);
      });
      const nonEmpty = buckets.filter((b) => b.length > 0);

      // 3. Insert groups. Each group carries its own games_per_match so
      //    score validation can use the right target — smaller groups (fewer
      //    matches per team) get longer matches to even out total play time.
      const insertedGroups = await insertGroups(
        nonEmpty.map((_, idx) => ({
          tournament_id: tournament.id,
          name: `Grupp ${idx + 1}`,
          sort_order: idx,
          games_per_match: groupGames[idx] ?? baseGamesPerMatch,
        }))
      );

      // 4. Assign group_id to each team.
      const teamsByGroup = new Map<string, TournamentTeam[]>();
      for (let gi = 0; gi < nonEmpty.length; gi++) {
        const groupId = insertedGroups[gi].id;
        const updated: TournamentTeam[] = [];
        for (const t of nonEmpty[gi]) {
          await assignTeamGroup(t.id, groupId);
          updated.push({ ...t, group_id: groupId, seed: null });
        }
        teamsByGroup.set(groupId, updated);
      }

      // 5. Generate matches. Each group only schedules into its assigned
      //    courts; if a group has nothing assigned (e.g. user reduced
      //    numGroups after assigning), fall back to all selected courts so
      //    the algorithm doesn't throw. Match by sort_order rather than
      //    array index so we don't depend on Supabase preserving insert order.
      const chosenCourts = courts.filter((c) => selectedCourts.has(c.id));
      const courtsByGroupId = new Map<string, Court[]>();
      for (const g of insertedGroups) {
        const own = chosenCourts.filter(
          (c) => courtGroupIdx[c.id] === g.sort_order
        );
        courtsByGroupId.set(g.id, own.length > 0 ? own : chosenCourts);
      }
      const { matches, restingByRound } = generateGroupMatches(teamsByGroup, courtsByGroupId);
      await insertMatches(matches);

      // 5b. Persist resting teams per round.
      const restRows: { tournament_id: string; round_number: number; team_id: string }[] = [];
      for (const [roundNumber, teamIds] of restingByRound) {
        for (const teamId of teamIds) {
          restRows.push({ tournament_id: tournament.id, round_number: roundNumber, team_id: teamId });
        }
      }
      await insertRoundRests(restRows);

      // 6. Activate tournament.
      const teamsPerGroup = nonEmpty.map((b) => b.length);
      const totalRounds = totalRoundsFor(teamsPerGroup);
      await activateTournament(tournament.id, {
        num_groups: nonEmpty.length,
        games_per_match: tournamentGamesPerMatch,
        total_rounds: totalRounds,
        formation: "random",
        advances_per_group: advancesPerGroup > 0 ? advancesPerGroup : null,
        bracket_mode: "single",
        has_bronze: hasBronze,
        qf_court_ids: [...qfCourtIds],
        sf_court_ids: [...sfCourtIds],
        final_court_ids: [...finalCourtIds],
      });

      router.push(`/${tenant.slug}/tournament/${tournament.id}/host`);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-700 px-6 py-5">
        <Link
          href={`/${tenant.slug}/tournament/${tournament.id}/plan`}
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Tillbaka till plan
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{tournament.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Starta session</p>
      </header>

      {err && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {err}
        </div>
      )}

      {!formatSupported && (
        <div className="mx-6 mt-4 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          Bara Gruppspel kan startas just nu. Ändra speltyp på planen.
        </div>
      )}

      <main className="p-6 pb-28 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
        {soloTeams.length > 0 && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Para ihop solospelare
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              {soloTeams.length} spelare letar partner.
            </p>
            <div className="space-y-2">
              {soloTeams.map((t) => {
                const p1 = playerMap.get(t.player1_id);
                const currentPair = pairing[t.id] ?? null;
                const options = availableForPairing.filter(
                  (p) =>
                    p.id === currentPair ||
                    !Object.values(pairing).includes(p.id)
                );
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2"
                  >
                    <span className="flex-1 text-sm font-medium">
                      {p1?.name ?? "?"}
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">+</span>
                    <div className="flex-1">
                      <PlayerCombobox
                        value={currentPair}
                        selectedName={
                          currentPair
                            ? (playerMap.get(currentPair)?.name ?? null)
                            : null
                        }
                        options={options}
                        onSelect={(id) =>
                          setPairing((prev) => ({ ...prev, [t.id]: id }))
                        }
                        onClear={() =>
                          setPairing((prev) => ({ ...prev, [t.id]: null }))
                        }
                        allowClear
                        placeholder="Skriv namn på partner…"
                      />
                    </div>
                    <button
                      onClick={() => dropSolo(t.id)}
                      className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-red-500 px-2"
                    >
                      Ta bort
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Inställningar</h2>

          {fullTeamCount >= 4 && (() => {
            const presets = getPresets(fullTeamCount);
            if (presets.length === 0) return null;
            return (
              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">Rekommenderat upplägg</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((p) => {
                    const total = p.groups * p.advances;
                    const active = numGroups === p.groups && advancesPerGroup === p.advances;
                    // Use auto-balanced games-per-group for the preset's team
                    // distribution rather than the current selection — that way
                    // a preset's time estimate reflects the per-group balancing
                    // it would produce if selected.
                    const presetBase = Math.floor(fullTeamCount / p.groups);
                    const presetRem = fullTeamCount % p.groups;
                    const presetTeams = Array.from({ length: p.groups }, (_, i) =>
                      presetBase + (i < presetRem ? 1 : 0)
                    );
                    const presetGroupGames = autoBalanceGroupGames(baseGamesPerMatch, presetTeams);
                    const presetEst = estimateTournamentTime(
                      fullTeamCount, p.groups, p.advances, hasBronze,
                      presetGroupGames, Math.max(1, activeCourtsForEstimate),
                    );
                    return (
                      <button
                        key={`${p.groups}-${p.advances}`}
                        type="button"
                        onClick={() => {
                          setNumGroups(p.groups);
                          setAdvancesPerGroup(p.advances);
                          if (p.advances === 0) setHasBronze(false);
                        }}
                        className="px-3 py-1.5 rounded-full border text-xs font-medium transition"
                        style={active
                          ? { backgroundColor: accent, borderColor: accent, color: "#fff" }
                          : { borderColor: "#d4d4d8", color: "#52525b" }
                        }
                      >
                        {p.groups} grupper × {p.advances} vidare
                        <span className="ml-1.5 opacity-70">· {stageLabel(total)}</span>
                        <span className="ml-1.5 opacity-60">· ~{fmtTime(presetEst.totalMinutes)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div>
            <label className="text-xs font-medium block mb-1 text-zinc-500 dark:text-zinc-400">
              Antal grupper: {numGroups}
            </label>
            <input
              type="range"
              min={1}
              max={Math.max(1, Math.min(8, fullTeamCount))}
              value={numGroups}
              onChange={(e) => setNumGroups(parseInt(e.target.value, 10))}
              className="w-full"
              disabled={fullTeamCount < 1}
            />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
              {fullTeamCount} fulla lag tillgängliga
              {numGroups >= 1 && fullTeamCount >= numGroups && (
                <> · <span className="font-medium">{Math.floor(fullTeamCount / numGroups)} lag per grupp</span></>
              )}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1 text-zinc-500 dark:text-zinc-400">
              Games per match, tiebreak vid {baseGamesPerMatch - 1}-{baseGamesPerMatch - 1}
            </label>
            <input
              type="number"
              min={1}
              max={99}
              value={baseGamesPerMatch}
              onChange={(e) =>
                setBaseGamesPerMatch(
                  Math.max(1, parseInt(e.target.value || "1", 10))
                )
              }
              className="w-32 px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100"
            />
            {numGroups > 1 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                Mindre grupper spelar längre matcher så att totaltid per spelare jämnas ut.
              </p>
            )}
          </div>

          {numGroups > 1 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Games per match per grupp
                </label>
                {touchedGroups.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTouchedGroups(new Set());
                      setGroupGames(
                        autoBalanceGroupGames(
                          baseGamesPerMatch,
                          teamsPerGroupArray.length > 0
                            ? teamsPerGroupArray
                            : Array(numGroups).fill(2)
                        )
                      );
                    }}
                    className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline"
                  >
                    Återställ auto-balans
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from({ length: numGroups }, (_, idx) => {
                  const teamsHere = teamsPerGroupArray[idx];
                  const isTouched = touchedGroups.has(idx);
                  return (
                    <div
                      key={idx}
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-2 bg-zinc-50/60 dark:bg-zinc-800/40"
                    >
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 flex items-center justify-between gap-1">
                        <span>Grupp {idx + 1}</span>
                        {teamsHere !== undefined && (
                          <span className="text-zinc-400 dark:text-zinc-500">{teamsHere} lag</span>
                        )}
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={groupGames[idx] ?? baseGamesPerMatch}
                        onChange={(e) =>
                          setGroupGameAt(
                            idx,
                            Math.max(1, parseInt(e.target.value || "1", 10))
                          )
                        }
                        className="w-full px-2 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 text-sm tabular-nums"
                      />
                      {!isTouched && teamsHere !== undefined && (
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">auto</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Slutspel</h2>
          <div>
            <label className="text-xs font-medium block mb-1 text-zinc-500 dark:text-zinc-400">
              Lag som går vidare per grupp
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={Math.max(0, Math.floor(fullTeamCount / Math.max(1, numGroups)))}
                value={advancesPerGroup}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setAdvancesPerGroup(v);
                  if (v === 0) setHasBronze(false);
                }}
                className="flex-1"
              />
              <span className="text-sm font-semibold tabular-nums w-6 text-center">
                {advancesPerGroup === 0 ? "–" : advancesPerGroup}
              </span>
            </div>
            {advancesPerGroup > 0 && (() => {
              const total = advancesPerGroup * numGroups;
              const { qf: qfCourts, sf: sfCourts, final: finalCourts } =
                playoffMatchCounts(total, hasBronze);
              const court = (n: number) => n === 1 ? "1 bana" : `${n} banor`;
              if (total <= 2) return (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {total} lag totalt → Final <span className="text-zinc-400 dark:text-zinc-500">({court(finalCourts)})</span>
                </p>
              );
              if (total <= 4) return (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {total} lag totalt →{" "}
                  Semifinal <span className="text-zinc-400 dark:text-zinc-500">({court(sfCourts)})</span>
                  {" → "}
                  Final <span className="text-zinc-400 dark:text-zinc-500">({court(finalCourts)})</span>
                </p>
              );
              return (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {total} lag totalt →{" "}
                  Kvartsfinal <span className="text-zinc-400 dark:text-zinc-500">({court(qfCourts)})</span>
                  {" → "}
                  Semifinal <span className="text-zinc-400 dark:text-zinc-500">({court(sfCourts)})</span>
                  {" → "}
                  Final <span className="text-zinc-400 dark:text-zinc-500">({court(finalCourts)})</span>
                </p>
              );
            })()}
            {advancesPerGroup === 0 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Inget slutspel</p>
            )}
          </div>
          {advancesPerGroup > 1 && (() => {
            const total = advancesPerGroup * numGroups;
            const bracketCount =
              total >= 16 && total % 8 === 0 ? total / 8 : 1;
            if (bracketCount <= 1) return null;
            return (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/40 text-xs text-zinc-600 dark:text-zinc-300">
                <span className="font-medium">{bracketCount} slutspel automatiskt</span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {" "}— de 8 främsta lagen går till A-slutspel, nästa 8 till B-slutspel{bracketCount > 2 ? ", och så vidare" : ""}.
                </span>
              </div>
            );
          })()}
          {advancesPerGroup > 0 && (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Bronsmatch</span>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Match om tredjeplats</p>
              </div>
              <button
                type="button"
                onClick={() => setHasBronze((v) => !v)}
                aria-pressed={hasBronze}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${hasBronze ? "" : "bg-zinc-300"}`}
                style={hasBronze ? { backgroundColor: accent } : undefined}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${hasBronze ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
          )}

          {advancesPerGroup > 0 && courts.length > 0 && (
            <div className="pt-2 border-t border-zinc-100 space-y-3">
              <p className="text-xs font-medium text-zinc-500">Banor för slutspel</p>
              {(() => {
                const totalAdvancing = advancesPerGroup * numGroups;
                const stages: { key: "qf" | "sf" | "final"; label: string; state: Set<string>; setter: React.Dispatch<React.SetStateAction<Set<string>>> }[] = [];
                if (totalAdvancing > 4) stages.push({ key: "qf", label: "Kvartsfinal", state: qfCourtIds, setter: setQfCourtIds });
                if (totalAdvancing > 2) stages.push({ key: "sf", label: "Semifinal", state: sfCourtIds, setter: setSfCourtIds });
                stages.push({ key: "final", label: "Final", state: finalCourtIds, setter: setFinalCourtIds });
                return stages.map(({ key, label, state, setter }) => (
                  <div key={key}>
                    <p className="text-xs text-zinc-600 font-medium mb-1">{label}</p>
                    <div className="flex flex-wrap gap-2">
                      {courts.map((c) => {
                        const on = state.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setter((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.id)) next.delete(c.id);
                                else next.add(c.id);
                                return next;
                              });
                            }}
                            className="px-2.5 py-1 rounded-full border text-xs font-medium transition"
                            style={on
                              ? { backgroundColor: accent, borderColor: accent, color: "#fff" }
                              : { borderColor: "#d4d4d8", color: "#52525b" }
                            }
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </section>

        {fullTeamCount >= 2 && estimate.totalMinutes > 0 && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Tidsuppskattning</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="text-zinc-500 dark:text-zinc-400">Per match</div>
              <div className="font-medium tabular-nums">~{fmtTime(estimate.matchMinutes)}</div>

              <div className="text-zinc-500 dark:text-zinc-400">Gruppspel</div>
              <div className="font-medium tabular-nums">~{fmtTime(estimate.groupMinutes)}</div>

              {estimate.playoffMinutes > 0 && (
                <>
                  <div className="text-zinc-500 dark:text-zinc-400">Slutspel</div>
                  <div className="font-medium tabular-nums">~{fmtTime(estimate.playoffMinutes)}</div>
                </>
              )}

              <div className="text-zinc-500 dark:text-zinc-400 font-semibold pt-1 border-t border-zinc-100 dark:border-zinc-800">Totalt</div>
              <div className="font-semibold tabular-nums pt-1 border-t border-zinc-100 dark:border-zinc-800" style={{ color: accent }}>
                ~{fmtTime(estimate.totalMinutes)}
              </div>
            </div>
            {selectedCourts.size === 0 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                Baserat på {activeCourtsForEstimate} rekommenderade {activeCourtsForEstimate === 1 ? "bana" : "banor"} — välj banor nedan för exaktare uppskattning.
              </p>
            )}
          </section>
        )}

        </div>{/* end left column */}

        <div className="space-y-5">
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Lottning</h2>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "automatic", label: "Automatisk", desc: "Slumpa lag i grupperna" },
              { value: "manual", label: "Manuell", desc: "Dra lag till valfri grupp" },
            ] as const).map((opt) => {
              const active = lottning === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLottning(opt.value)}
                  aria-pressed={active}
                  className="text-left rounded-lg border px-3 py-2 transition"
                  style={active
                    ? { borderColor: accent, backgroundColor: `${accent}10` }
                    : { borderColor: "#e4e4e7" }
                  }
                >
                  <div className="text-sm font-medium" style={active ? { color: accent } : undefined}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Banor</h2>
            {fullTeamCount >= 2 && suggestedCourtsPerGroup.length > 0 && (
              <div className="text-xs mt-0.5 space-y-0.5">
                {suggestedCourtsPerGroup.map((rec, i) => {
                  const assigned = groupCourtCounts[i] ?? 0;
                  const teams = teamsPerGroupArray[i];
                  const color =
                    assigned === rec
                      ? accent
                      : assigned < rec
                        ? "#d97706"
                        : "#71717a";
                  const banorWord = rec === 1 ? "bana" : "banor";
                  return (
                    <div key={i} style={{ color }}>
                      {numGroups > 1 ? `Grupp ${i + 1}: ` : ""}
                      {teams} lag → {rec} {banorWord} rekommenderas
                      {assigned !== rec && (
                        <span className="text-zinc-500 dark:text-zinc-400">
                          {" "}
                          ({assigned} {assigned === 1 ? "vald" : "valda"})
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {courts.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Inga banor finns. Lägg till banor i inställningarna först.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {courts.map((c) => {
                const checked = selectedCourts.has(c.id);
                const g = courtGroupIdx[c.id] ?? 0;
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <label className="flex-1 flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCourt(c.id)}
                      />
                      <span className="text-sm font-medium">{c.name}</span>
                    </label>
                    {numGroups > 1 && (
                      <select
                        value={g}
                        onChange={(e) => {
                          e.stopPropagation();
                          setCourtGroup(c.id, parseInt(e.target.value, 10));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={!checked}
                        className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100 text-xs disabled:bg-zinc-50 dark:disabled:bg-zinc-900 disabled:text-zinc-400 dark:disabled:text-zinc-500"
                      >
                        {Array.from({ length: numGroups }, (_, i) => (
                          <option key={i} value={i}>
                            Grupp {i + 1}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {numGroups > 1 &&
            selectedCourts.size > 0 &&
            !allGroupsHaveCourts && (
              <p className="text-xs text-amber-600 mt-2">
                Varje grupp behöver minst en bana.
              </p>
            )}
        </section>

        </div>{/* end right column */}
        </div>{/* end grid */}
      </main>

      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={submit}
          disabled={!canSubmit || submitting}
          className="px-6 py-3 rounded-full text-white text-sm font-semibold shadow-lg shadow-black/20 disabled:opacity-50 disabled:cursor-not-allowed transition-transform active:scale-95"
          style={{ backgroundColor: accent }}
        >
          {submitting
            ? lottning === "manual" ? "Öppnar lottning…" : "Startar..."
            : lottning === "manual" ? "Lotta lag →" : "Starta session →"}
        </button>
      </div>
    </div>
  );
}
