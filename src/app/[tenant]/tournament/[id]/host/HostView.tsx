"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";
import type {
  Tenant,
  Tournament,
  TournamentMatch,
  TournamentTeam,
  TournamentGroup,
  Court,
  Player,
  MatchStage,
} from "@/lib/supabase/types";
import { updateMatchScore } from "@/lib/db/matches";
import { setPlayerPaid, insertMatches, getRoundRests, completeTournament } from "@/lib/db/tournaments";
import { computeStandings, teamName, stageLabel, shortTeamName } from "@/lib/standings";
import { PaymentPanel, type PaymentPlayerRow } from "@/components/PaymentPanel";
import {
  badgeClassForMatch,
  buildGroupIndex,
  groupPaletteFor,
} from "@/lib/group-colors";
import {
  generateFirstKORound,
  generateNextKORound,
  byeCount,
  type GroupStanding,
} from "@/lib/algorithms/knockout";
import type { RoundRest } from "@/lib/supabase/types";

const KO_STAGE_LABEL: Record<string, string> = {
  quarter_final: "Kvartsfinal",
  semi_final: "Semifinal",
  final: "Final",
  bronze: "Bronsmatch",
};

function koStageBadgeColor(stage: string): string {
  switch (stage) {
    case "final": return "#d97706";
    case "semi_final": return "#7c3aed";
    case "bronze": return "#b45309";
    default: return "#059669"; // quarter_final / fallback → emerald
  }
}

type Loaded = {
  tournament: Tournament;
  groups: TournamentGroup[];
  teams: TournamentTeam[];
  matches: TournamentMatch[];
  players: Player[];
  courts: Court[];
  rests: RoundRest[];
};

export function HostView({
  tenant,
  tournamentId,
}: {
  tenant: Tenant;
  tournamentId: string;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Loaded | null> => {
    try {
      const [tRes, gRes, teamsRes, matchesRes, courtsRes] = await Promise.all([
        supabaseClient
          .from("tournaments")
          .select("*")
          .eq("id", tournamentId)
          .single(),
        supabaseClient
          .from("tournament_groups")
          .select("*")
          .eq("tournament_id", tournamentId)
          .order("sort_order"),
        supabaseClient
          .from("tournament_teams")
          .select("*")
          .eq("tournament_id", tournamentId),
        supabaseClient
          .from("tournament_matches")
          .select("*")
          .eq("tournament_id", tournamentId)
          .order("round_number")
          .order("created_at"),
        supabaseClient
          .from("courts")
          .select("*")
          .eq("tenant_id", tenant.id)
          .order("sort_order"),
      ]);
      if (tRes.error) throw tRes.error;
      if (gRes.error) throw gRes.error;
      if (teamsRes.error) throw teamsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      if (courtsRes.error) throw courtsRes.error;

      const teams = (teamsRes.data ?? []) as TournamentTeam[];
      const playerIds = Array.from(
        new Set(
          teams.flatMap((t) =>
            t.player2_id ? [t.player1_id, t.player2_id] : [t.player1_id]
          )
        )
      );
      const [playersRes, rests] = await Promise.all([
        playerIds.length
          ? supabaseClient.from("players").select("*").in("id", playerIds)
          : Promise.resolve({ data: [], error: null }),
        getRoundRests(tournamentId),
      ]);
      if (playersRes.error) throw playersRes.error;

      const loaded: Loaded = {
        tournament: tRes.data as Tournament,
        groups: (gRes.data ?? []) as TournamentGroup[],
        teams,
        matches: (matchesRes.data ?? []) as TournamentMatch[],
        players: (playersRes.data ?? []) as Player[],
        courts: (courtsRes.data ?? []) as Court[],
        rests,
      };
      setData(loaded);
      return loaded;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  }, [tenant.id, tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: re-load whenever any match in this tournament changes so locked
  // cards unlock immediately when a blocking match is scored.
  useEffect(() => {
    const channel = supabaseClient
      .channel(`host:${tournamentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_matches",
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => load()
      )
      .subscribe();

    // Reload on tab-visible so the host view recovers after the laptop sleeps.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);

    // Periodic fallback in case realtime drops without a visibility event.
    const timer = setInterval(() => { void load(); }, 15_000);

    return () => {
      supabaseClient.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [tournamentId, load]);

  if (err)
    return (
      <div className="p-8 text-red-600">
        Fel: {err}
      </div>
    );
  if (!data) return <div className="p-8 text-zinc-500">Laddar...</div>;

  return (
    <HostInner
      tenant={tenant}
      data={data}
      reload={load}
      busy={busy}
      setBusy={setBusy}
    />
  );
}

function HostInner({
  tenant,
  data,
  reload,
  busy,
  setBusy,
}: {
  tenant: Tenant;
  data: Loaded;
  reload: () => Promise<Loaded | null>;
  busy: string | null;
  setBusy: (s: string | null) => void;
}) {
  const { tournament, groups, teams, matches, players, courts, rests } = data;
  const accent = tenant.primary_color || "#10b981";

  type PaidKey = `${string}-${1 | 2}`;
  const [paidKeys, setPaidKeys] = useState<Set<PaidKey>>(() => {
    const s = new Set<PaidKey>();
    for (const t of teams) {
      if (t.player1_paid_at) s.add(`${t.id}-1` as PaidKey);
      if (t.player2_paid_at) s.add(`${t.id}-2` as PaidKey);
    }
    return s;
  });

  async function handleSetPaid(teamId: string, slot: 1 | 2, paid: boolean) {
    await setPlayerPaid(teamId, slot, paid);
    setPaidKeys((prev) => {
      const next = new Set(prev);
      const key = `${teamId}-${slot}` as PaidKey;
      if (paid) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const playerMap = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);
  const teamMap = useMemo(() => {
    const m = new Map<string, TournamentTeam>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);
  const groupMap = useMemo(() => {
    const m = new Map<string, TournamentGroup>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);
  const groupIndexMap = useMemo(() => buildGroupIndex(groups), [groups]);
  const courtMap = useMemo(() => {
    const m = new Map<string, Court>();
    for (const c of courts) m.set(c.id, c);
    return m;
  }, [courts]);

  // Per-match UI state for the group-column list view: completed (locked with
  // edit), ready (steppers visible), or blocked (waiting for a team's earlier
  // round or the assigned court to free up).
  type MatchUiState = "completed" | "ready" | "blocked";
  const matchUiStates = useMemo(() => {
    const map = new Map<string, { state: MatchUiState; reason: string | null }>();
    for (const m of matches) {
      if (m.stage !== "group") continue;
      if (m.status === "completed") {
        map.set(m.id, { state: "completed", reason: null });
        continue;
      }
      const blockers: string[] = [];
      for (const teamId of [m.team1_id, m.team2_id]) {
        const earlier = matches.some(
          (o) =>
            o.id !== m.id &&
            o.stage === "group" &&
            o.status !== "completed" &&
            o.round_number < m.round_number &&
            (o.team1_id === teamId || o.team2_id === teamId)
        );
        if (earlier) {
          const t = teamMap.get(teamId);
          if (t) blockers.push(shortTeamName(t, playerMap));
        }
      }
      let courtBusy: string | null = null;
      if (m.court_id) {
        const courtBlocking = matches.some(
          (o) =>
            o.id !== m.id &&
            o.court_id === m.court_id &&
            o.status !== "completed" &&
            o.round_number < m.round_number
        );
        if (courtBlocking) {
          courtBusy = courtMap.get(m.court_id)?.name ?? null;
        }
      }
      if (blockers.length > 0 || courtBusy) {
        const parts: string[] = [];
        if (blockers.length > 0) parts.push(`Väntar på ${blockers.join(" & ")}`);
        if (courtBusy) parts.push(`${courtBusy} upptagen`);
        map.set(m.id, { state: "blocked", reason: parts.join(" · ") });
      } else {
        map.set(m.id, { state: "ready", reason: null });
      }
    }
    return map;
  }, [matches, teamMap, playerMap, courtMap]);

  const paymentRows: PaymentPlayerRow[] = useMemo(() => {
    const rows: PaymentPlayerRow[] = [];
    for (const t of teams) {
      const p1 = playerMap.get(t.player1_id);
      if (p1) {
        rows.push({
          key: `${t.id}-1`,
          teamId: t.id,
          slot: 1,
          displayName: p1.name,
          paid: paidKeys.has(`${t.id}-1` as PaidKey),
        });
      }
      if (t.player2_id) {
        const p2 = playerMap.get(t.player2_id);
        if (p2) {
          rows.push({
            key: `${t.id}-2`,
            teamId: t.id,
            slot: 2,
            displayName: p2.name,
            paid: paidKeys.has(`${t.id}-2` as PaidKey),
          });
        }
      }
    }
    return rows;
  }, [teams, playerMap, paidKeys]);

  const completedCount = useMemo(
    () => matches.filter((m) => m.status === "completed").length,
    [matches]
  );
  const totalMatches = matches.length;

  // The active "round" is the lowest round number that still has unfinished matches.
  // All courts wait on this round until every match in it is completed before
  // advancing — once they all complete, this naturally becomes the next round.
  const currentRound = useMemo(() => {
    let r: number | null = null;
    for (const m of matches) {
      if (m.status !== "completed") {
        if (r === null || m.round_number < r) r = m.round_number;
      }
    }
    return r;
  }, [matches]);

  const matchByCourt = useMemo(() => {
    const map = new Map<string, TournamentMatch>();

    // KO phase: session-based — each court independently shows its next
    // incomplete KO match so QF and SF can run simultaneously.
    const incompleteKO = matches.filter(
      (m) => m.stage !== "group" && m.status !== "completed"
    );
    if (incompleteKO.length > 0) {
      for (const c of courts) {
        const next = matches
          .filter(
            (m) =>
              m.court_id === c.id &&
              m.stage !== "group" &&
              m.status !== "completed"
          )
          .sort((a, b) => a.round_number - b.round_number)[0];
        if (next) map.set(c.id, next);
      }
      return map;
    }

    // Group phase: session-based — each court independently advances to its
    // next unfinished match rather than waiting for the whole round to finish.
    for (const c of courts) {
      const next = matches
        .filter((m) => m.court_id === c.id && m.stage === "group" && m.status !== "completed")
        .sort((a, b) => a.round_number - b.round_number)[0];
      if (next) map.set(c.id, next);
    }
    return map;
  }, [courts, matches]);

  // Round progress counter: how many group matches in the current round are done.
  const roundCompleted = useMemo(() => {
    if (currentRound === null) return 0;
    return matches.filter(
      (m) => m.stage === "group" && m.round_number === currentRound && m.status === "completed"
    ).length;
  }, [matches, currentRound]);
  const roundTotal = useMemo(() => {
    if (currentRound === null) return 0;
    return matches.filter(
      (m) => m.stage === "group" && m.round_number === currentRound
    ).length;
  }, [matches, currentRound]);

  // Only courts that this tournament actually uses, sorted by group of first match.
  const tournamentCourts = useMemo(() => {
    const used = courts.filter((c) => matches.some((m) => m.court_id === c.id));
    return used.sort((a, b) => {
      const ma = matches.find((m) => m.court_id === a.id);
      const mb = matches.find((m) => m.court_id === b.id);
      const ga = ma?.group_id ? groupIndexMap.get(ma.group_id) ?? 9999 : 9999;
      const gb = mb?.group_id ? groupIndexMap.get(mb.group_id) ?? 9999 : 9999;
      if (ga !== gb) return ga - gb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }, [courts, matches, groupIndexMap]);

  // Sort tournamentCourts so matches in the same group sit next to each other for the
  // current round (idle courts during group phase still appear in tournament-court order).
  const sortedCourts = useMemo(() => {
    const decorated = tournamentCourts.map((c, idx) => ({ court: c, idx }));
    decorated.sort((a, b) => {
      const ma = matchByCourt.get(a.court.id);
      const mb = matchByCourt.get(b.court.id);
      if (!ma && !mb) return a.idx - b.idx;
      if (!ma) return 1;
      if (!mb) return -1;
      const ga = ma.group_id ? groupIndexMap.get(ma.group_id) ?? 9999 : 9999;
      const gb = mb.group_id ? groupIndexMap.get(mb.group_id) ?? 9999 : 9999;
      if (ga !== gb) return ga - gb;
      return a.idx - b.idx;
    });
    return decorated.map((d) => d.court);
  }, [tournamentCourts, matchByCourt, groupIndexMap]);

  // --- Playoff derived state ---
  const groupMatches = useMemo(() => matches.filter((m) => m.stage === "group"), [matches]);
  const koMatches = useMemo(() => matches.filter((m) => m.stage !== "group"), [matches]);
  const allGroupDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed");

  // For each court's upcoming match, collect any teams that are still finishing
  // an earlier-round match on a different court. A match is only unblocked once
  // all of its players' prior matches have been scored.
  const blockedBy = useMemo(() => {
    const map = new Map<string, TournamentTeam[]>();
    const isKOPhase = koMatches.some((m) => m.status !== "completed");
    if (isKOPhase) return map;
    for (const [courtId, m] of matchByCourt.entries()) {
      const blocking: TournamentTeam[] = [];
      for (const teamId of [m.team1_id, m.team2_id]) {
        const hasEarlierUnfinished = matches.some(
          (other) =>
            other.court_id !== courtId &&
            other.stage === "group" &&
            other.status !== "completed" &&
            (other.team1_id === teamId || other.team2_id === teamId) &&
            other.round_number < m.round_number
        );
        if (hasEarlierUnfinished) {
          const t = teamMap.get(teamId);
          if (t) blocking.push(t);
        }
      }
      if (blocking.length > 0) map.set(courtId, blocking);
    }
    return map;
  }, [matchByCourt, matches, koMatches, teamMap]);
  const hasKO = koMatches.length > 0;
  const advancesPerGroup = tournament.advances_per_group ?? 0;

  type TournamentPhase = "group_active" | "ready_for_playoff" | "ko_active" | "done";
  const tournamentPhase = useMemo((): TournamentPhase => {
    if (!allGroupDone) return "group_active";
    if (!hasKO && advancesPerGroup > 0) return "ready_for_playoff";
    if (hasKO) {
      // "done" only when every KO match (including bronze) is complete
      const allKODone = koMatches.every((m) => m.status === "completed");
      return allKODone ? "done" : "ko_active";
    }
    return "done";
  }, [allGroupDone, hasKO, advancesPerGroup, koMatches]);

  // Within ko_active: find the current incomplete KO stage (ignoring bronze)
  const activeKOStage = useMemo(() => {
    const incomplete = koMatches.filter((m) => m.status !== "completed" && m.stage !== "bronze");
    if (incomplete.length > 0) return incomplete[0].stage;
    return null;
  }, [koMatches]);

  // Progress per KO stage — used in header and court grouping.
  const koStageProgress = useMemo(() => {
    if (!hasKO) return [];
    const stages: MatchStage[] = ["quarter_final", "semi_final", "final"];
    if (koMatches.some((m) => m.stage === "bronze")) stages.push("bronze");
    return stages
      .map((stage) => {
        const sm = koMatches.filter((m) => m.stage === stage);
        if (sm.length === 0) return null;
        return { stage, completed: sm.filter((m) => m.status === "completed").length, total: sm.length };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [hasKO, koMatches]);

  // All distinct KO stages currently running (incomplete, non-bronze).
  const runningKOStages = useMemo(
    () => [...new Set(koMatches.filter((m) => m.status !== "completed" && m.stage !== "bronze").map((m) => m.stage))],
    [koMatches]
  );

  // Round-number based: the most recently completed non-bronze KO round.
  // Stage labels can repeat across rounds (e.g. play-in QF then real QF for
  // 9+ team brackets), so we key by round_number, not stage.
  const lastCompletedKORound = useMemo(() => {
    const complete = koMatches.filter((m) => m.status === "completed" && m.stage !== "bronze");
    if (complete.length === 0) return null;
    return Math.max(...complete.map((m) => m.round_number));
  }, [koMatches]);

  // Bye teams for the next KO round: advancing teams that haven't yet played
  // any KO match. Includes top seeds that skipped the first KO round and
  // any subsequent-round byes (rare but possible with odd brackets).
  const byeTeamIdsForNextRound = useMemo(() => {
    if (advancesPerGroup === 0) return [];
    const advancingIds = new Set<string>();
    for (const g of groups) {
      const groupTeams = teams.filter((t) => t.group_id === g.id);
      const groupMatchesForGroup = groupMatches.filter((m) => m.group_id === g.id);
      const standings = computeStandings(groupTeams, groupMatchesForGroup, playerMap).slice(0, advancesPerGroup);
      for (const s of standings) advancingIds.add(s.team_id);
    }
    const playedInKO = new Set<string>();
    for (const m of koMatches) {
      playedInKO.add(m.team1_id);
      playedInKO.add(m.team2_id);
    }
    return [...advancingIds].filter((id) => !playedInKO.has(id));
  }, [groups, teams, groupMatches, playerMap, advancesPerGroup, koMatches]);

  // Group standings for playoff panel
  const groupStandings = useMemo((): GroupStanding[] => {
    if (advancesPerGroup === 0) return [];
    return groups.map((g) => {
      const groupTeams = teams.filter((t) => t.group_id === g.id);
      const groupMatchesForGroup = groupMatches.filter((m) => m.group_id === g.id);
      const standings = computeStandings(groupTeams, groupMatchesForGroup, playerMap).slice(0, advancesPerGroup);
      return { groupId: g.id, groupName: g.name, standings };
    });
  }, [groups, teams, groupMatches, playerMap, advancesPerGroup]);

  const totalAdvancingKO = useMemo(
    () => groupStandings.reduce((s, g) => s + g.standings.length, 0),
    [groupStandings]
  );
  const firstKORoundNum = useMemo(
    () => (koMatches.length > 0 ? Math.min(...koMatches.map((m) => m.round_number)) : null),
    [koMatches]
  );

  // Resting team for the current round (group phase)
  const restingTeamIdsThisRound = useMemo(() => {
    // Collect every round number currently shown on a court. With session-based
    // advancement courts can be on different rounds simultaneously, so we can't
    // rely on a single currentRound value.
    const displayedRounds = new Set<number>();
    const playingTeamIds = new Set<string>();
    for (const m of matchByCourt.values()) {
      displayedRounds.add(m.round_number);
      if (m.team1_id) playingTeamIds.add(m.team1_id);
      if (m.team2_id) playingTeamIds.add(m.team2_id);
    }
    if (displayedRounds.size === 0) return [];
    return rests
      .filter((r) => displayedRounds.has(r.round_number))
      .map((r) => r.team_id)
      .filter((id) => !playingTeamIds.has(id));
  }, [rests, matchByCourt]);

  // Play-in matches have stage "quarter_final" but should be labeled "Inledningsrunda"
  // when they are in the first KO round and there were more than 8 advancing teams.
  function matchDisplayStageLabel(m: TournamentMatch): string {
    if (m.stage === "quarter_final" && totalAdvancingKO > 8 && m.round_number === firstKORoundNum) {
      return "Inledningsrunda";
    }
    return stageLabel(m, groupMap);
  }

  // Automatically generates the next KO round's match for each completed pair
  // of feeder matches, enabling QF and SF to run simultaneously.
  async function autoAdvanceKO(loaded: Loaded): Promise<boolean> {
    const { tournament: t, courts: c, matches: allMatches, groups: g, teams: tm } = loaded;
    const koAll = allMatches.filter((m) => m.stage !== "group");
    if (koAll.length === 0) return false;

    const completedNonBronze = koAll.filter(
      (m) => m.status === "completed" && m.stage !== "bronze"
    );
    if (completedNonBronze.length === 0) return false;

    // Compute external bye teams (advancing teams that haven't played KO yet).
    const apg = t.advances_per_group ?? 0;
    const externalByeIds: string[] = [];
    if (apg > 0) {
      const gMatches = allMatches.filter((m) => m.stage === "group");
      const pm = new Map<string, Player>();
      for (const p of loaded.players) pm.set(p.id, p);
      const advancingIds = new Set<string>();
      for (const grp of g) {
        const gTeams = tm.filter((tt) => tt.group_id === grp.id);
        const gM = gMatches.filter((m) => m.group_id === grp.id);
        const standings = computeStandings(gTeams, gM, pm).slice(0, apg);
        for (const s of standings) advancingIds.add(s.team_id);
      }
      const playedInKO = new Set<string>(koAll.flatMap((m) => [m.team1_id, m.team2_id]));
      externalByeIds.push(...[...advancingIds].filter((id) => !playedInKO.has(id)));
    }

    const allKORounds = [
      ...new Set(koAll.filter((m) => m.stage !== "bronze").map((m) => m.round_number)),
    ].sort((a, b) => a - b);
    const firstKORound = allKORounds[0] ?? 1;

    let generated = false;

    for (const roundNum of allKORounds) {
      const roundMatches = koAll
        .filter((m) => m.round_number === roundNum && m.stage !== "bronze")
        .sort((a, b) => {
          const dt = a.created_at.localeCompare(b.created_at);
          return dt !== 0 ? dt : a.id.localeCompare(b.id);
        });
      const nextRound = roundNum + 1;
      const nextRoundMatches = koAll.filter(
        (m) => m.round_number === nextRound && m.stage !== "bronze"
      );

      const relevantByeIds = roundNum === firstKORound ? externalByeIds : [];
      const n = roundMatches.length;

      if (relevantByeIds.length > 0) {
        // Has external byes: require all matches in round to finish, then generate all.
        if (!roundMatches.every((m) => m.status === "completed")) continue;
        if (nextRoundMatches.length > 0) continue;
        const next = generateNextKORound(roundMatches as TournamentMatch[], relevantByeIds, c, t.id, t.has_bronze);
        if (next.length > 0) { await insertMatches(next); generated = true; }
        continue;
      }

      // No external byes: generate pair by pair as soon as both feeders complete.
      const newMatches: Omit<TournamentMatch, "id" | "created_at">[] = [];
      for (let i = 0; i < Math.floor(n / 2); i++) {
        const m1 = roundMatches[i];
        const m2 = roundMatches[n - 1 - i];
        if (m1.status !== "completed" || m2.status !== "completed") continue;

        const w1 = (m1.score_team1 ?? 0) > (m1.score_team2 ?? 0) ? m1.team1_id : m1.team2_id;
        const w2 = (m2.score_team1 ?? 0) > (m2.score_team2 ?? 0) ? m2.team1_id : m2.team2_id;

        const alreadyExists =
          nextRoundMatches.some(
            (m) => (m.team1_id === w1 && m.team2_id === w2) || (m.team1_id === w2 && m.team2_id === w1)
          ) ||
          newMatches.some(
            (m) => (m.team1_id === w1 && m.team2_id === w2) || (m.team1_id === w2 && m.team2_id === w1)
          );
        if (alreadyExists) continue;

        const nextTotal = Math.floor(n / 2);
        const stage: MatchStage = nextTotal === 1 ? "final" : nextTotal <= 2 ? "semi_final" : "quarter_final";
        const court = c.find((cc) => cc.id === m1.court_id) ?? c[i % c.length] ?? null;

        newMatches.push({
          tournament_id: t.id, group_id: null, round_number: nextRound,
          court_id: court?.id ?? null, team1_id: w1, team2_id: w2,
          score_team1: null, score_team2: null, status: "scheduled", stage,
        });

        if (t.has_bronze && stage === "final" && n === 2) {
          const l1 = (m1.score_team1 ?? 0) > (m1.score_team2 ?? 0) ? m1.team2_id : m1.team1_id;
          const l2 = (m2.score_team1 ?? 0) > (m2.score_team2 ?? 0) ? m2.team2_id : m2.team1_id;
          const bronzeCourt = c.find((cc) => cc.id === m2.court_id) ?? c[Math.floor(c.length / 2)] ?? c[0] ?? null;
          newMatches.push({
            tournament_id: t.id, group_id: null, round_number: nextRound,
            court_id: bronzeCourt?.id ?? null, team1_id: l1, team2_id: l2,
            score_team1: null, score_team2: null, status: "scheduled", stage: "bronze",
          });
        }
      }
      if (newMatches.length > 0) { await insertMatches(newMatches); generated = true; }
    }
    return generated;
  }

  const [completing, setCompleting] = useState(false);
  const [completeErr, setCompleteErr] = useState<string | null>(null);

  async function handleComplete(): Promise<void> {
    if (!confirm("Avsluta sessionen? Alla matcher är klara och sessionen flyttas till Avslutade.")) return;
    setCompleting(true);
    setCompleteErr(null);
    try {
      await completeTournament(tournament.id);
      await reload();
    } catch (e) {
      setCompleteErr((e as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  async function saveScore(
    match: TournamentMatch,
    s1: number,
    s2: number
  ): Promise<void> {
    setBusy(match.id);
    try {
      await updateMatchScore(match.id, s1, s2, "completed");
      const loaded = await reload();
      if (match.stage !== "group" && loaded) {
        const generated = await autoAdvanceKO(loaded);
        if (generated) await reload();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-6 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">
            {tournament.name}
          </h1>
          <p className="text-xs text-zinc-500">
            {tenant.name} · Mål {tournament.games_per_match} game
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(tournamentPhase === "ko_active" || tournamentPhase === "done") && koStageProgress.length > 0 ? (
            koStageProgress.map(({ stage, completed, total }) => (
              <div key={stage} className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div className="text-[10px] uppercase tracking-wide leading-none mb-0.5 font-semibold"
                  style={{ color: koStageBadgeColor(stage) }}>
                  {KO_STAGE_LABEL[stage] ?? stage}
                </div>
                <div className="text-sm font-semibold tabular-nums leading-tight">
                  {completed}
                  <span className="text-zinc-400 font-normal">/{total}</span>
                  <span className="text-zinc-500 font-normal text-[11px] ml-1">klara</span>
                </div>
              </div>
            ))
          ) : (
            currentRound !== null && (
              <div className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 leading-none mb-0.5">
                  Runda{" "}
                  {tournament.total_rounds > 0
                    ? `${currentRound}/${tournament.total_rounds}`
                    : currentRound}
                </div>
                <div className="text-sm font-semibold tabular-nums leading-tight">
                  {roundCompleted}
                  <span className="text-zinc-400 font-normal">/{roundTotal}</span>
                  <span className="text-zinc-500 font-normal text-[11px] ml-1">banor</span>
                </div>
              </div>
            )
          )}
          <div className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 leading-none mb-0.5">
              Totalt
            </div>
            <div className="text-sm font-semibold tabular-nums leading-tight">
              {completedCount}
              <span className="text-zinc-400 font-normal">/{totalMatches}</span>
            </div>
          </div>
          <Link
            href={`/${tenant.slug}/tournament/${tournament.id}/display`}
            target="_blank"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            Öppna TV-visning
          </Link>
        </div>
      </header>

      {tournament.status === "completed" && (
        <div className="border-b border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
            </svg>
            Sessionen är avslutad
          </div>
          <Link
            href={`/${tenant.slug}`}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            ← Tillbaka till sessioner
          </Link>
        </div>
      )}

      {tournamentPhase === "done" && tournament.status !== "completed" && (
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Alla matcher klara!
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Markera sessionen som avslutad för att flytta den till arkivet.
            </p>
            {completeErr && (
              <p className="text-xs text-red-600 mt-1">{completeErr}</p>
            )}
          </div>
          <button
            onClick={handleComplete}
            disabled={completing}
            className="shrink-0 px-5 py-2 rounded-md text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: accent }}
          >
            {completing ? "Avslutar…" : "Avsluta session →"}
          </button>
        </div>
      )}

      {tournamentPhase === "ready_for_playoff" && (
        <PlayoffPanel
          tournament={tournament}
          groupStandings={groupStandings}
          koMatches={koMatches}
          courts={courts}
          accent={accent}
          lastCompletedKORound={lastCompletedKORound}
          byeTeamIds={byeTeamIdsForNextRound}
          teamMap={teamMap}
          playerMap={playerMap}
          onGenerated={reload}
        />
      )}

      <main className="px-5 py-4 grid lg:grid-cols-[1fr_300px] gap-5">
        <section className="min-w-0">
          {!hasKO ? (
            <>
              {restingTeamIdsThisRound.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {restingTeamIdsThisRound.map((tid) => {
                    const t = teamMap.get(tid);
                    if (!t) return null;
                    const name = shortTeamName(t, playerMap);
                    return (
                      <div
                        key={tid}
                        title={`Vilar: ${name}`}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 max-w-[14rem] truncate cursor-default"
                      >
                        Vilar: {name}
                      </div>
                    );
                  })}
                </div>
              )}
              {groups.length === 0 ? (
                <div className="text-sm text-zinc-500">Inga grupper.</div>
              ) : (
                <div
                  className="grid gap-3 items-start overflow-x-auto"
                  style={{
                    gridTemplateColumns: `repeat(${groups.length}, minmax(280px, 1fr))`,
                  }}
                >
                  {groups.map((g, gi) => (
                    <GroupColumn
                      key={g.id}
                      group={g}
                      paletteIndex={gi}
                      groupTeams={teams.filter((t) => t.group_id === g.id)}
                      groupMatches={matches.filter(
                        (m) => m.stage === "group" && m.group_id === g.id
                      )}
                      playerMap={playerMap}
                      teamMap={teamMap}
                      courtMap={courtMap}
                      matchUiStates={matchUiStates}
                      advancesPerGroup={advancesPerGroup}
                      gamesPerMatch={tournament.games_per_match}
                      onSave={saveScore}
                      busyId={busy}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  Aktiva matcher
                </h2>
                {runningKOStages.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {runningKOStages.map((stage) => (
                      <span
                        key={stage}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: koStageBadgeColor(stage) }}
                      >
                        {KO_STAGE_LABEL[stage] ?? stage}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {runningKOStages.length > 1 ? (
                <div className="space-y-4">
                  {(["quarter_final", "semi_final", "final", "bronze"] as const).map((stage) => {
                    const stageCourts = sortedCourts.filter(
                      (c) => matchByCourt.get(c.id)?.stage === stage
                    );
                    if (stageCourts.length === 0) return null;
                    return (
                      <div key={stage}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: koStageBadgeColor(stage) }}
                          >
                            {KO_STAGE_LABEL[stage] ?? stage}
                          </span>
                          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                        </div>
                        <div
                          className={`grid gap-2 ${stageCourts.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}
                        >
                          {stageCourts.map((c) => {
                            const m = matchByCourt.get(c.id)!;
                            const blocking = blockedBy.get(c.id);
                            if (blocking && blocking.length > 0) {
                              return (
                                <LockedCard
                                  key={m.id}
                                  match={m}
                                  team1={teamMap.get(m.team1_id)!}
                                  team2={teamMap.get(m.team2_id)!}
                                  playerMap={playerMap}
                                  courtName={c.name}
                                  stage={matchDisplayStageLabel(m)}
                                  badgeClass={badgeClassForMatch(m, groupIndexMap)}
                                  blockingTeams={blocking}
                                />
                              );
                            }
                            return (
                              <MatchCard
                                key={m.id}
                                match={m}
                                team1={teamMap.get(m.team1_id)!}
                                team2={teamMap.get(m.team2_id)!}
                                playerMap={playerMap}
                                courtName={c.name}
                                stage={matchDisplayStageLabel(m)}
                                badgeClass={badgeClassForMatch(m, groupIndexMap)}
                                onSave={(s1, s2) => saveScore(m, s1, s2)}
                                busy={busy === m.id}
                                gamesPerMatch={tournament.games_per_match}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`grid gap-2 ${courts.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}
                >
                  {courts.length === 0 && (
                    <div className="text-sm text-zinc-500">Inga banor.</div>
                  )}
                  {sortedCourts.map((c) => {
                    const m = matchByCourt.get(c.id);
                    if (!m) return null;
                    const blocking = blockedBy.get(c.id);
                    if (blocking && blocking.length > 0) {
                      return (
                        <LockedCard
                          key={m.id}
                          match={m}
                          team1={teamMap.get(m.team1_id)!}
                          team2={teamMap.get(m.team2_id)!}
                          playerMap={playerMap}
                          courtName={c.name}
                          stage={matchDisplayStageLabel(m)}
                          badgeClass={badgeClassForMatch(m, groupIndexMap)}
                          blockingTeams={blocking}
                        />
                      );
                    }
                    return (
                      <MatchCard
                        key={m.id}
                        match={m}
                        team1={teamMap.get(m.team1_id)!}
                        team2={teamMap.get(m.team2_id)!}
                        playerMap={playerMap}
                        courtName={c.name}
                        stage={matchDisplayStageLabel(m)}
                        badgeClass={badgeClassForMatch(m, groupIndexMap)}
                        onSave={(s1, s2) => saveScore(m, s1, s2)}
                        busy={busy === m.id}
                        gamesPerMatch={tournament.games_per_match}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="space-y-4">
          {hasKO && (
            <KOResultsPanel
              koMatches={koMatches}
              teamMap={teamMap}
              playerMap={playerMap}
            />
          )}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
              Betalning
            </h2>
            <PaymentPanel
              players={paymentRows}
              accent={tenant.primary_color || "#10b981"}
              onSetPaid={handleSetPaid}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}

// --- PlayoffPanel ---
// Shown when: all group play done + no KO matches yet (ready_for_playoff)
// OR: a KO round just finished and there's a next round to generate.

function PlayoffPanel({
  tournament,
  groupStandings,
  koMatches,
  courts,
  accent,
  lastCompletedKORound,
  byeTeamIds,
  teamMap,
  playerMap,
  onGenerated,
}: {
  tournament: Tournament;
  groupStandings: GroupStanding[];
  koMatches: TournamentMatch[];
  courts: Court[];
  accent: string;
  lastCompletedKORound: number | null;
  byeTeamIds: string[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onGenerated: () => Promise<any>;
}) {
  const isFirstRound = koMatches.length === 0;
  const hasBronze = tournament.has_bronze;

  const byes = byeCount(groupStandings);
  const [byeGroupIds, setByeGroupIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const previewMatchups = useMemo(() => {
    if (!isFirstRound) return [];
    return generateFirstKORound(
      groupStandings,
      Array.from(byeGroupIds),
      [],
      tournament.id,
      hasBronze
    );
  }, [isFirstRound, groupStandings, byeGroupIds, tournament.id, hasBronze]);

  // Matches completed in the most recent KO round (used to feed generateNextKORound).
  const completedRoundMatches = useMemo(() => {
    if (isFirstRound || lastCompletedKORound === null) return [];
    return koMatches.filter(
      (m) => m.round_number === lastCompletedKORound && m.status === "completed" && m.stage !== "bronze"
    );
  }, [isFirstRound, koMatches, lastCompletedKORound]);

  // Number of entrants in the round we're about to generate. Each match takes 2.
  const nextRoundEntrants = useMemo(() => {
    if (isFirstRound) {
      // First round entrants are computed inside generateFirstKORound; use preview length × 2.
      return previewMatchups.length * 2;
    }
    return completedRoundMatches.length + byeTeamIds.length;
  }, [isFirstRound, previewMatchups, completedRoundMatches, byeTeamIds]);

  const recommendedCount = useMemo(() => {
    if (isFirstRound) return previewMatchups.length;
    const matchCount = Math.floor(nextRoundEntrants / 2);
    // Bronze is only generated when we're going from 2 semis to a Final.
    const goingToFinal = nextRoundEntrants === 2;
    const bronzeCount = hasBronze && goingToFinal && completedRoundMatches.length === 2 ? 1 : 0;
    return matchCount + bronzeCount;
  }, [isFirstRound, previewMatchups, nextRoundEntrants, completedRoundMatches, hasBronze]);

  const [selectedCourts, setSelectedCourts] = useState<Set<string>>(
    () => new Set(courts.slice(0, recommendedCount).map((c) => c.id))
  );

  const chosenCourts = courts.filter((c) => selectedCourts.has(c.id));

  const canGenerate =
    chosenCourts.length > 0 &&
    byeGroupIds.size === byes;

  const totalAdvancing = groupStandings.reduce((s, g) => s + g.standings.length, 0);
  const stageLabel = isFirstRound
    ? firstKOStageLabel(totalAdvancing)
    : stageLabelForEntrants(nextRoundEntrants);

  const bracketPath = useMemo(
    () => (isFirstRound ? computeBracketPath(totalAdvancing, hasBronze) : []),
    [isFirstRound, totalAdvancing, hasBronze]
  );

  async function generate() {
    if (!canGenerate) return;
    setErr(null);
    setGenerating(true);
    try {
      let newMatches;
      if (isFirstRound) {
        newMatches = generateFirstKORound(
          groupStandings,
          Array.from(byeGroupIds),
          chosenCourts,
          tournament.id,
          hasBronze
        );
      } else {
        newMatches = generateNextKORound(
          completedRoundMatches,
          byeTeamIds,
          chosenCourts,
          tournament.id,
          hasBronze
        );
      }
      if (newMatches.length === 0) {
        setErr("Inga matcher kunde genereras. Kontrollera inställningarna.");
        return;
      }
      await insertMatches(newMatches);
      await onGenerated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          {stageLabel}
        </span>
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {isFirstRound ? "Starta slutspel" : `Generera ${stageLabel}`}
        </h2>
      </div>

      {err && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {/* Group standings with advancing teams highlighted */}
      {isFirstRound && (
        <div
          className="mb-4 grid gap-3"
          style={{ gridTemplateColumns: `repeat(${groupStandings.length}, minmax(0, 1fr))` }}
        >
          {groupStandings.map((g, gi) => {
            const palette = groupPaletteFor(gi);
            return (
              <div key={g.groupId} className={`rounded-lg border overflow-hidden`}>
                <div className={`px-3 py-1.5 text-xs font-semibold ${palette.bar}`}>
                  {g.groupName} — vidare
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {g.standings.map((s, i) => {
                    const t = teamMap.get(s.team_id);
                    return (
                      <div key={s.team_id} className="px-3 py-1.5 flex items-center gap-2">
                        <span className="text-xs text-zinc-400 w-4">{i + 1}</span>
                        <span className="text-xs font-medium truncate">{t ? shortTeamName(t, playerMap) : s.teamName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bracket roadmap — shows the full path and which step is being generated now */}
      {isFirstRound && bracketPath.length > 0 && (
        <div className="mb-4 flex items-center gap-1.5 flex-wrap">
          {bracketPath.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-zinc-300 text-xs">→</span>}
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border ${
                  step.isNow
                    ? "text-white border-transparent"
                    : "text-zinc-400 bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
                }`}
                style={step.isNow ? { backgroundColor: koStageBadgeColor(
                  step.label === "Kvartsfinal" ? "quarter_final"
                    : step.label === "Semifinal" ? "semi_final"
                    : step.label === "Final" ? "final"
                    : step.label === "Bronsmatch" ? "bronze"
                    : "quarter_final"
                ) } : undefined}
              >
                <span>{step.label}</span>
                <span className={step.isNow ? "text-white/70" : "text-zinc-300"}>
                  {step.matchCount === 1 ? "" : ` ×${step.matchCount}`}
                </span>
                {!step.isNow && (
                  <span className="text-[10px] text-zinc-300 font-normal ml-0.5">auto</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Match preview — only shows the matches being generated right now */}
      {isFirstRound && previewMatchups.length > 0 && (
        <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-semibold bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-between">
            <span>
              {stageLabel === "Inledningsrunda"
                ? "Inledningsrunda — dessa matcher spelas först"
                : "Matchningar"}
            </span>
            {stageLabel === "Inledningsrunda" && (
              <span className="text-zinc-400 font-normal">övriga kvartsfinalsmatcher auto-genereras</span>
            )}
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {previewMatchups.map((m, i) => {
              const t1 = teamMap.get(m.team1_id);
              const t2 = teamMap.get(m.team2_id);
              return (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                  <span className="text-zinc-400 w-4 shrink-0">{i + 1}</span>
                  <span className="font-medium truncate">{t1 ? shortTeamName(t1, playerMap) : "?"}</span>
                  <span className="text-zinc-400 shrink-0">vs</span>
                  <span className="font-medium truncate">{t2 ? shortTeamName(t2, playerMap) : "?"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bye selection */}
      {isFirstRound && byes > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
            {byes} frival — välj vilka grupper:
          </p>
          <div className="flex flex-wrap gap-2">
            {groupStandings.map((g) => {
              const checked = byeGroupIds.has(g.groupId);
              const disabled = !checked && byeGroupIds.size >= byes;
              return (
                <label key={g.groupId} className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer ${disabled ? "opacity-40" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      setByeGroupIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(g.groupId);
                        else next.delete(g.groupId);
                        return next;
                      });
                    }}
                    className="rounded"
                  />
                  {g.groupName}
                </label>
              );
            })}
          </div>
          {byeGroupIds.size < byes && (
            <p className="text-[10px] text-amber-700 mt-1">Välj {byes - byeGroupIds.size} till</p>
          )}
        </div>
      )}

      {/* Court selection */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs font-medium text-zinc-500">Banor för slutspelsrundan:</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">
              Rekommenderat: {recommendedCount} {recommendedCount === 1 ? "bana" : "banor"} (en per match)
            </span>
            {selectedCourts.size !== recommendedCount && (
              <button
                onClick={() =>
                  setSelectedCourts(new Set(courts.slice(0, recommendedCount).map((c) => c.id)))
                }
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
              >
                Återställ
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {courts.map((c) => {
            const checked = selectedCourts.has(c.id);
            return (
              <label key={c.id} className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelectedCourts((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                  className="rounded"
                />
                {c.name}
              </label>
            );
          })}
        </div>
      </div>

      <button
        onClick={generate}
        disabled={!canGenerate || generating}
        className="px-5 py-2 rounded-md text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: accent }}
      >
        {generating ? "Genererar..." : `Generera ${stageLabel} →`}
      </button>
    </div>
  );
}

function firstKOStageLabel(total: number): string {
  if (total <= 2) return "Final";
  if (total <= 4) return "Semifinal";
  if (total > 8) return "Inledningsrunda"; // play-in before QF
  return "Kvartsfinal";
}

function stageLabelForEntrants(n: number): string {
  if (n === 2) return "Final";
  if (n <= 4) return "Semifinal";
  return "Kvartsfinal";
}

// Returns the full bracket path for display in the panel, given the number of advancing teams.
// Each step is { label, matchCount, isNow } where isNow = first step being generated.
type BracketStep = { label: string; matchCount: number; isNow: boolean };
function computeBracketPath(totalAdvancing: number, hasBronze: boolean): BracketStep[] {
  const steps: BracketStep[] = [];

  if (totalAdvancing > 8) {
    const playIn = totalAdvancing - 8;
    steps.push({ label: "Inledningsrunda", matchCount: playIn, isNow: true });
    steps.push({ label: "Kvartsfinal", matchCount: 4, isNow: false });
    steps.push({ label: "Semifinal", matchCount: 2, isNow: false });
  } else if (totalAdvancing > 4) {
    // Top (8 - n) seeds get internal byes; the remaining (n - 4) pairs play QF.
    const qfMatches = totalAdvancing - 4;
    steps.push({ label: "Kvartsfinal", matchCount: qfMatches, isNow: true });
    steps.push({ label: "Semifinal", matchCount: 2, isNow: false });
  } else if (totalAdvancing > 2) {
    const sfMatches = Math.floor(totalAdvancing / 2);
    const isPlayIn = totalAdvancing === 3;
    steps.push({ label: isPlayIn ? "Inledningsrunda" : "Semifinal", matchCount: sfMatches, isNow: true });
    // Final is added by the unconditional push below — don't push it here.
  }

  steps.push({ label: "Final", matchCount: 1, isNow: totalAdvancing <= 2 });
  if (hasBronze) steps.push({ label: "Bronsmatch", matchCount: 1, isNow: false });
  return steps;
}

function MatchCard({
  match,
  team1,
  team2,
  playerMap,
  courtName,
  stage,
  badgeClass,
  onSave,
  busy,
  gamesPerMatch,
}: {
  match: TournamentMatch;
  team1: TournamentTeam;
  team2: TournamentTeam;
  playerMap: Map<string, Player>;
  courtName: string;
  stage: string;
  badgeClass: string;
  onSave: (s1: number, s2: number) => Promise<void>;
  busy: boolean;
  gamesPerMatch: number;
}) {
  const [s1, setS1] = useState<string>(
    match.score_team1 != null ? String(match.score_team1) : ""
  );
  const [s2, setS2] = useState<string>(
    match.score_team2 != null ? String(match.score_team2) : ""
  );
  const s1Ref = useRef<HTMLInputElement>(null);
  const s2Ref = useRef<HTMLInputElement>(null);

  // Defensive reset: key={match.id} already causes a remount on match change,
  // but this handles any edge case where the same component instance receives a new match.
  useEffect(() => {
    setS1(match.score_team1 != null ? String(match.score_team1) : "");
    setS2(match.score_team2 != null ? String(match.score_team2) : "");
  }, [match.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = parseInt(s1, 10);
  const b = parseInt(s2, 10);
  const aFilled = s1 !== "" && !Number.isNaN(a);
  const bFilled = s2 !== "" && !Number.isNaN(b);
  const bothFilled = aFilled && bFilled;

  let validationMsg: string | null = null;
  if (aFilled && (a < 0 || a > gamesPerMatch)) {
    validationMsg = `Max är ${gamesPerMatch} game.`;
  } else if (bFilled && (b < 0 || b > gamesPerMatch)) {
    validationMsg = `Max är ${gamesPerMatch} game.`;
  } else if (bothFilled && a === b) {
    validationMsg = `Oavgjort är inte tillåtet.`;
  } else if (bothFilled && a !== gamesPerMatch && b !== gamesPerMatch) {
    validationMsg = `Vinnaren måste ha ${gamesPerMatch} game.`;
  }

  const isValid = bothFilled && validationMsg === null;

  const submit = () => {
    if (!isValid) return;
    void onSave(a, b);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && isValid) {
      e.preventDefault();
      submit();
    }
  };

  const team1Label = shortTeamName(team1, playerMap);
  const team2Label = shortTeamName(team2, playerMap);
  const inputClass =
    "w-12 h-9 rounded border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-base font-semibold text-center tabular-nums focus:outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-zinc-900 disabled:opacity-50";

  return (
    <div className="rounded-lg border bg-white dark:bg-zinc-900 p-2.5 border-zinc-200 dark:border-zinc-800">
      <div className="flex justify-between items-center text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
        <span className="font-semibold">{courtName}</span>
        <div className="flex items-center gap-1.5">
          <span
            className={`px-1.5 py-px rounded font-semibold ${badgeClass}`}
          >
            {stage}
          </span>
          <span className="text-zinc-400">Mål {gamesPerMatch}</span>
        </div>
      </div>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 min-w-0 flex items-center justify-end text-right text-sm font-medium px-2 bg-zinc-50 dark:bg-zinc-800/40 rounded">
          <span className="truncate">{team1Label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            ref={s1Ref}
            type="number"
            inputMode="numeric"
            min={0}
            max={gamesPerMatch}
            value={s1}
            placeholder="0"
            aria-label={`Resultat för ${team1Label}`}
            onChange={(e) => {
              const next = e.target.value;
              setS1(next);
              if (next.length > 0 && s2 === "") {
                s2Ref.current?.focus();
                s2Ref.current?.select();
              }
            }}
            onKeyDown={onKeyDown}
            className={inputClass}
            disabled={busy}
          />
          <span className="text-zinc-400 text-sm">–</span>
          <input
            ref={s2Ref}
            type="number"
            inputMode="numeric"
            min={0}
            max={gamesPerMatch}
            value={s2}
            placeholder="0"
            aria-label={`Resultat för ${team2Label}`}
            onChange={(e) => {
              const next = e.target.value;
              setS2(next);
              if (next.length > 0 && s1 === "") {
                s1Ref.current?.focus();
                s1Ref.current?.select();
              }
            }}
            onKeyDown={onKeyDown}
            className={inputClass}
            disabled={busy}
          />
          <button
            onClick={submit}
            disabled={busy || !isValid}
            className="ml-0.5 h-9 px-3 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "…" : "Klar"}
          </button>
        </div>
        <div className="flex-1 min-w-0 flex items-center justify-start text-left text-sm font-medium px-2 bg-zinc-50 dark:bg-zinc-800/40 rounded">
          <span className="truncate">{team2Label}</span>
        </div>
      </div>
      {validationMsg && (
        <div className="mt-1 text-[10px] text-red-600 text-center">
          {validationMsg}
        </div>
      )}
    </div>
  );
}

// Shows completed KO match results, grouped by stage (newest stage first).
function KOResultsPanel({
  koMatches,
  teamMap,
  playerMap,
}: {
  koMatches: TournamentMatch[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
}) {
  const completed = koMatches.filter((m) => m.status === "completed");
  if (completed.length === 0) return null;

  const stageOrder: MatchStage[] = ["bronze", "final", "semi_final", "quarter_final"];
  const grouped = stageOrder
    .map((stage) => ({
      stage,
      matches: completed.filter((m) => m.stage === stage),
    }))
    .filter((g) => g.matches.length > 0);

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 font-medium text-sm text-zinc-700 dark:text-zinc-300">
        Slutspelsresultat
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {grouped.map(({ stage, matches }) => (
          <div key={stage}>
            <div
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: koStageBadgeColor(stage) }}
            >
              {KO_STAGE_LABEL[stage] ?? stage}
            </div>
            {matches.map((m) => {
              const t1 = teamMap.get(m.team1_id);
              const t2 = teamMap.get(m.team2_id);
              const t1Wins = (m.score_team1 ?? 0) > (m.score_team2 ?? 0);
              return (
                <div key={m.id} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                  <span className={`flex-1 truncate font-medium ${t1Wins ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"}`}>
                    {t1 ? shortTeamName(t1, playerMap) : "?"}
                  </span>
                  <span className="tabular-nums font-bold shrink-0 text-zinc-700 dark:text-zinc-300">
                    {m.score_team1 ?? "–"}–{m.score_team2 ?? "–"}
                  </span>
                  <span className={`flex-1 truncate font-medium text-right ${!t1Wins ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"}`}>
                    {t2 ? shortTeamName(t2, playerMap) : "?"}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function slutspelLabel(position: number, advancesPerGroup: number): string | null {
  if (advancesPerGroup <= 0 || position > advancesPerGroup) return null;
  return `${String.fromCharCode(64 + position)}-slutspel`;
}

function ScoreStepper({
  value,
  onChange,
  disabled,
  max,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  max: number;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex flex-col items-stretch select-none text-zinc-700 dark:text-zinc-200">
      <button
        type="button"
        aria-label={`${ariaLabel} öka`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        className="h-5 w-9 rounded-t border border-b-0 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center"
      >
        <svg viewBox="0 0 10 6" className="w-2.5 h-1.5" aria-hidden>
          <path d="M0 6 L5 0 L10 6 Z" fill="currentColor" />
        </svg>
      </button>
      <div className="h-7 w-9 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-sm font-bold tabular-nums">
        {value}
      </div>
      <button
        type="button"
        aria-label={`${ariaLabel} minska`}
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={disabled || value <= 0}
        className="h-5 w-9 rounded-b border border-t-0 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center"
      >
        <svg viewBox="0 0 10 6" className="w-2.5 h-1.5" aria-hidden>
          <path d="M0 0 L10 0 L5 6 Z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

type MatchUiStateKey = "ready" | "completed" | "blocked";

function MatchRow({
  match,
  team1,
  team2,
  playerMap,
  courtName,
  uiState,
  reason,
  gamesPerMatch,
  onSave,
  busy,
}: {
  match: TournamentMatch;
  team1: TournamentTeam | undefined;
  team2: TournamentTeam | undefined;
  playerMap: Map<string, Player>;
  courtName: string | null;
  uiState: MatchUiStateKey;
  reason: string | null;
  gamesPerMatch: number;
  onSave: (m: TournamentMatch, s1: number, s2: number) => Promise<void>;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [s1, setS1] = useState<number>(match.score_team1 ?? 0);
  const [s2, setS2] = useState<number>(match.score_team2 ?? 0);

  // Sync local steppers to incoming match data (e.g. realtime updates),
  // unless the user is currently editing a completed match.
  useEffect(() => {
    if (editing) return;
    setS1(match.score_team1 ?? 0);
    setS2(match.score_team2 ?? 0);
  }, [match.id, match.score_team1, match.score_team2, editing]);

  const isCompleted = uiState === "completed";
  const isBlocked = uiState === "blocked";
  const showInputs = uiState === "ready" || (isCompleted && editing);

  const isValid =
    s1 !== s2 &&
    (s1 === gamesPerMatch || s2 === gamesPerMatch) &&
    s1 <= gamesPerMatch &&
    s2 <= gamesPerMatch;

  async function handleSave() {
    if (!isValid) return;
    await onSave(match, s1, s2);
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
    setS1(match.score_team1 ?? 0);
    setS2(match.score_team2 ?? 0);
  }

  const team1Label = team1 ? shortTeamName(team1, playerMap) : "?";
  const team2Label = team2 ? shortTeamName(team2, playerMap) : "?";

  return (
    <div className={`px-3 py-2 ${isBlocked ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""}`}>
      <div className="flex items-center gap-2">
        <span
          className="flex-1 min-w-0 text-right text-sm font-medium truncate"
          title={team1Label}
        >
          {team1Label}
        </span>

        {showInputs ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <ScoreStepper
              value={s1}
              onChange={setS1}
              disabled={busy}
              max={gamesPerMatch}
              ariaLabel={team1Label}
            />
            <span className="text-zinc-400 text-sm">–</span>
            <ScoreStepper
              value={s2}
              onChange={setS2}
              disabled={busy}
              max={gamesPerMatch}
              ariaLabel={team2Label}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800/60 font-bold tabular-nums text-base">
            <span
              className={
                isCompleted && (match.score_team1 ?? 0) > (match.score_team2 ?? 0)
                  ? "text-emerald-700 dark:text-emerald-400"
                  : isCompleted
                  ? "text-zinc-400"
                  : "text-zinc-300"
              }
            >
              {match.score_team1 ?? "–"}
            </span>
            <span className="text-zinc-400 text-sm">–</span>
            <span
              className={
                isCompleted && (match.score_team2 ?? 0) > (match.score_team1 ?? 0)
                  ? "text-emerald-700 dark:text-emerald-400"
                  : isCompleted
                  ? "text-zinc-400"
                  : "text-zinc-300"
              }
            >
              {match.score_team2 ?? "–"}
            </span>
          </div>
        )}

        <span
          className="flex-1 min-w-0 text-left text-sm font-medium truncate"
          title={team2Label}
        >
          {team2Label}
        </span>

        <div className="shrink-0 flex items-center">
          {showInputs ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !isValid}
              className="px-2.5 h-9 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "…" : "Klar"}
            </button>
          ) : isCompleted ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Redigera resultat"
              title="Redigera resultat"
              className="h-9 w-9 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
                aria-hidden
              >
                <path d="M2.695 14.762l-1.262 3.155a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.886L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.419a4 4 0 0 0-.885 1.343Z" />
              </svg>
            </button>
          ) : (
            <span
              aria-hidden
              className="h-9 w-9 flex items-center justify-center text-amber-500"
              title={reason ?? "Låst"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path
                  fillRule="evenodd"
                  d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          )}
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400 pl-1 min-h-[14px]">
        {courtName && <span className="font-medium">{courtName}</span>}
        {isBlocked && reason && (
          <>
            {courtName && <span className="text-zinc-300">·</span>}
            <span className="text-amber-600 dark:text-amber-400 font-medium truncate">
              {reason}
            </span>
          </>
        )}
        {isCompleted && editing && (
          <button
            type="button"
            onClick={cancelEdit}
            className="ml-auto text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100"
          >
            Avbryt
          </button>
        )}
      </div>
    </div>
  );
}

function GroupColumn({
  group,
  paletteIndex,
  groupTeams,
  groupMatches,
  playerMap,
  teamMap,
  courtMap,
  matchUiStates,
  advancesPerGroup,
  gamesPerMatch,
  onSave,
  busyId,
}: {
  group: TournamentGroup;
  paletteIndex: number;
  groupTeams: TournamentTeam[];
  groupMatches: TournamentMatch[];
  playerMap: Map<string, Player>;
  teamMap: Map<string, TournamentTeam>;
  courtMap: Map<string, Court>;
  matchUiStates: Map<string, { state: MatchUiStateKey; reason: string | null }>;
  advancesPerGroup: number;
  gamesPerMatch: number;
  onSave: (m: TournamentMatch, s1: number, s2: number) => Promise<void>;
  busyId: string | null;
}) {
  const palette = groupPaletteFor(paletteIndex);

  const matchesByRound = useMemo(() => {
    const map = new Map<number, TournamentMatch[]>();
    for (const m of groupMatches) {
      const arr = map.get(m.round_number) ?? [];
      arr.push(m);
      map.set(m.round_number, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [groupMatches]);

  const standings = useMemo(
    () => computeStandings(groupTeams, groupMatches, playerMap),
    [groupTeams, groupMatches, playerMap]
  );

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col min-w-0">
      <div className={`px-4 py-2 border-b font-semibold text-sm ${palette.bar}`}>
        {group.name}
      </div>

      <div>
        {matchesByRound.length === 0 && (
          <div className="px-4 py-3 text-xs text-zinc-500">Inga matcher.</div>
        )}
        {matchesByRound.map(([round, ms]) => (
          <div key={round}>
            <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900/60 text-[10px] font-bold uppercase tracking-wide text-zinc-500 border-y border-zinc-100 dark:border-zinc-800">
              Omgång {round}
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {ms.map((m) => {
                const ui =
                  matchUiStates.get(m.id) ?? { state: "ready" as const, reason: null };
                return (
                  <MatchRow
                    key={m.id}
                    match={m}
                    team1={teamMap.get(m.team1_id)}
                    team2={teamMap.get(m.team2_id)}
                    playerMap={playerMap}
                    courtName={
                      m.court_id ? courtMap.get(m.court_id)?.name ?? null : null
                    }
                    uiState={ui.state}
                    reason={ui.reason}
                    gamesPerMatch={gamesPerMatch}
                    onSave={onSave}
                    busy={busyId === m.id}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t-2 border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 bg-zinc-50/60 dark:bg-zinc-900/40">
            <tr>
              <th className="px-2 py-2 w-7">#</th>
              <th className="text-left px-2 py-2 font-medium">Lag</th>
              <th className="px-1 py-2">
                <abbr
                  title="Matcher spelade"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  MP
                </abbr>
              </th>
              <th className="px-1 py-2">
                <abbr
                  title="Vunna game"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  GF
                </abbr>
              </th>
              <th className="px-1 py-2">
                <abbr
                  title="Förlorade game"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  GA
                </abbr>
              </th>
              <th className="px-1 py-2">
                <abbr
                  title="Game-skillnad"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  GD
                </abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const t = teamMap.get(s.team_id);
              const slutspel = slutspelLabel(i + 1, advancesPerGroup);
              return (
                <tr
                  key={s.team_id}
                  className={`border-t border-zinc-100 dark:border-zinc-800 ${slutspel ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""}`}
                >
                  <td className="px-2 py-2 text-center text-zinc-500 align-top">
                    {i + 1}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div
                      className="font-medium truncate"
                      title={t ? teamName(t, playerMap) : s.teamName}
                    >
                      {t ? shortTeamName(t, playerMap) : s.teamName}
                    </div>
                    {slutspel && (
                      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        → {slutspel}
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-2 text-center align-top">{s.mp}</td>
                  <td className="px-1 py-2 text-center align-top">{s.gf}</td>
                  <td className="px-1 py-2 text-center align-top">{s.ga}</td>
                  <td className="px-1 py-2 text-center font-semibold align-top">
                    {s.gd > 0 ? `+${s.gd}` : s.gd}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LockedCard({
  match,
  team1,
  team2,
  playerMap,
  courtName,
  stage,
  badgeClass,
  blockingTeams,
}: {
  match: TournamentMatch;
  team1: TournamentTeam;
  team2: TournamentTeam;
  playerMap: Map<string, Player>;
  courtName: string;
  stage: string;
  badgeClass: string;
  blockingTeams: TournamentTeam[];
}) {
  const team1Label = shortTeamName(team1, playerMap);
  const team2Label = shortTeamName(team2, playerMap);
  const waitingFor = blockingTeams.map((t) => shortTeamName(t, playerMap)).join(" & ");
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-white dark:bg-zinc-900 p-2.5">
      <div className="flex justify-between items-center text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
        <span className="font-semibold">{courtName}</span>
        <div className="flex items-center gap-1.5">
          <span className={`px-1.5 py-px rounded font-semibold ${badgeClass}`}>{stage}</span>
          <span className="px-1.5 py-px rounded font-semibold bg-amber-100 text-amber-700">Nästa</span>
        </div>
      </div>
      <div className="flex items-stretch gap-2 opacity-50">
        <div className="flex-1 min-w-0 flex items-center justify-end text-right text-sm font-medium px-2 bg-zinc-50 dark:bg-zinc-800/40 rounded">
          <span className="truncate">{team1Label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-12 h-9 rounded border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-center text-zinc-300 text-lg font-bold">–</div>
          <span className="text-zinc-400 text-sm">–</span>
          <div className="w-12 h-9 rounded border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-center text-zinc-300 text-lg font-bold">–</div>
        </div>
        <div className="flex-1 min-w-0 flex items-center justify-start text-left text-sm font-medium px-2 bg-zinc-50 dark:bg-zinc-800/40 rounded">
          <span className="truncate">{team2Label}</span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400 font-medium">
        <span>Väntar på:</span>
        <span className="font-semibold">{waitingFor}</span>
      </div>
    </div>
  );
}

