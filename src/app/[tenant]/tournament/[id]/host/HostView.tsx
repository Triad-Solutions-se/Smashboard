"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
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
import {
  setPlayerPaid,
  insertMatches,
  getRoundRests,
  completeTournament,
  updateGamesPerMatch,
  reassignScheduledGroupCourts,
} from "@/lib/db/tournaments";
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
  generateSeededFirstRound,
  generateAutoFirstRound,
  autoBracketSeedOrders,
  computeSeedOrder,
  computeSeededByePairIndices,
  collectSeeds,
  bracketLabelAuto,
  bracketLetter,
  getKOWinnerId,
  getKOLoserId,
  KOTieError,
  type GroupStanding,
  type QualifiedTeam,
} from "@/lib/algorithms/knockout";
import type { RoundRest } from "@/lib/supabase/types";

const KO_STAGE_LABEL: Record<string, string> = {
  quarter_final: "Kvartsfinal",
  semi_final: "Semifinal",
  final: "Final",
  bronze: "Bronsmatch",
};

// Flattens per-group standings + team metadata into the seeded-bracket input
// shape. Each team carries its 0-based group rank, manual seed (if set), and
// standings tiebreakers so `computeSeedOrder` can pick a consistent overall seed.
function buildQualifiedTeams(
  groupStandings: GroupStanding[],
  teamMap: Map<string, TournamentTeam>
): QualifiedTeam[] {
  const out: QualifiedTeam[] = [];
  for (const g of groupStandings) {
    g.standings.forEach((s, rank) => {
      const team = teamMap.get(s.team_id);
      out.push({
        team_id: s.team_id,
        groupId: g.groupId,
        rank,
        manualSeed: team?.seed ?? null,
        gf: s.gf,
        gd: s.gd,
        ga: s.ga,
      });
    });
  }
  return out;
}

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

  // Header label: show single value when all groups match, otherwise "varierar"
  // so the host knows there's per-group config in play.
  const gamesLabel = useMemo(() => {
    const values = new Set<number>();
    for (const g of groups) {
      values.add(g.games_per_match ?? tournament.games_per_match);
    }
    if (values.size === 0) return `Mål ${tournament.games_per_match} game`;
    if (values.size === 1) return `Mål ${[...values][0]} game`;
    return `Mål varierar per grupp`;
  }, [groups, tournament.games_per_match]);

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

  // --- Playoff derived state ---
  const groupMatches = useMemo(() => matches.filter((m) => m.stage === "group"), [matches]);
  const koMatches = useMemo(() => matches.filter((m) => m.stage !== "group"), [matches]);
  const allGroupDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed");
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

  type WinnerPodium = {
    bracket: string | null;
    first: string | null;
  };
  const winners = useMemo<WinnerPodium[] | null>(() => {
    if (tournamentPhase !== "done") return null;

    if (hasKO) {
      const bracketKeys = [...new Set(koMatches.map((m) => m.bracket ?? "A"))].sort();
      return bracketKeys.map((bracket) => {
        const bMatches = koMatches.filter((m) => (m.bracket ?? "A") === bracket);
        const final = bMatches.find((m) => m.stage === "final" && m.status === "completed");
        let first: string | null = null;
        if (final) {
          const t1Wins = (final.score_team1 ?? 0) > (final.score_team2 ?? 0);
          first = t1Wins ? final.team1_id : final.team2_id;
        }
        return { bracket, first };
      });
    }

    const overall = computeStandings(teams, matches, playerMap);
    return [{ bracket: null, first: overall[0]?.team_id ?? null }];
  }, [tournamentPhase, hasKO, koMatches, teams, matches, playerMap]);

  // KO progress aggregated per bracket (A/B/C…). Used both in the header
  // status chips and inside each bracket section card.
  type BracketProgress = {
    bracket: string;
    completed: number;
    total: number;
    runningStage: MatchStage | null;
  };
  const koBracketProgress = useMemo<BracketProgress[]>(() => {
    if (!hasKO) return [];
    const map = new Map<string, BracketProgress>();
    const stageOrder: MatchStage[] = ["quarter_final", "semi_final", "final"];
    for (const m of koMatches) {
      const b = m.bracket ?? "A";
      let e = map.get(b);
      if (!e) {
        e = { bracket: b, completed: 0, total: 0, runningStage: null };
        map.set(b, e);
      }
      e.total++;
      if (m.status === "completed") e.completed++;
      else if (m.stage !== "bronze") {
        if (
          e.runningStage === null ||
          stageOrder.indexOf(m.stage) < stageOrder.indexOf(e.runningStage)
        ) {
          e.runningStage = m.stage;
        }
      }
    }
    return [...map.values()].sort((a, b) => a.bracket.localeCompare(b.bracket));
  }, [hasKO, koMatches]);

  // Group KO matches by bracket for rendering.
  const koByBracket = useMemo(() => {
    const map = new Map<string, TournamentMatch[]>();
    for (const m of koMatches) {
      const b = m.bracket ?? "A";
      const arr = map.get(b) ?? [];
      arr.push(m);
      map.set(b, arr);
    }
    return map;
  }, [koMatches]);

  const sortedBrackets = useMemo(
    () => [...koByBracket.keys()].sort(),
    [koByBracket]
  );

  // Number of distinct slutspel brackets present in the KO match data. Drives
  // labelling — single bracket → "Slutspel"; multi → "A-slutspel"/"B-slutspel"/…
  const hasMultipleBrackets = sortedBrackets.length > 1;

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

  // Per-advancing-team → bracket letter. Mirrors the assignment used by the
  // playoff starter panel so the group standings table shows the same A/B/…
  // that each team will land in (e.g. with 16 advancing into 2 brackets of 8,
  // positions 1–2 → A and 3–4 → B, not 1→A/2→B/3→C/4→D).
  const bracketByTeamId = useMemo(() => {
    const out = new Map<string, string>();
    if (groupStandings.length === 0) return out;
    if (tournament.bracket_mode === "split") {
      for (const g of groupStandings) {
        g.standings.forEach((s, rank) => {
          out.set(s.team_id, bracketLetter(rank));
        });
      }
      return out;
    }
    if (tournament.formation === "seeded") {
      for (const g of groupStandings) {
        for (const s of g.standings) out.set(s.team_id, "A");
      }
      return out;
    }
    const qualified = buildQualifiedTeams(groupStandings, teamMap);
    const seeds = autoBracketSeedOrders(groupStandings, qualified);
    for (const [letter, ids] of seeds) {
      for (const id of ids) out.set(id, letter);
    }
    return out;
  }, [groupStandings, tournament.bracket_mode, tournament.formation, teamMap]);

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

  // Per-bracket seeded advance. Each bracket runs the same algorithm in
  // isolation: round 1 emission order encodes pair-index (recovered by
  // sorting completed matches by created_at), byes (top seeds whose slot
  // pair contained a BYE) are interleaved into round 2 at their known pair
  // index, and subsequent rounds pair adjacent winners.
  //
  // Used for: formation === "seeded" (legacy single-bracket) AND
  // bracket_mode === "single" — covering both legacy single-bracket
  // tournaments and the new auto-bracket flow (which may carry multiple
  // bracket letters in match rows even when bracket_mode is stored as
  // "single"). Bracket count is inferred from the match data.
  async function autoAdvanceSeededKO(loaded: Loaded): Promise<boolean> {
    const { tournament: t, courts: c, matches: allMatches, groups: gs, teams: tm } = loaded;
    const apg = t.advances_per_group ?? 0;
    if (apg <= 0) return false;

    const koAll = allMatches.filter((m) => m.stage !== "group" && m.stage !== "bronze");
    if (koAll.length === 0) return false;

    const gMatches = allMatches.filter((m) => m.stage === "group");
    const pm = new Map<string, Player>();
    for (const p of loaded.players) pm.set(p.id, p);
    const teamById = new Map(tm.map((tt) => [tt.id, tt]));

    const groupStandings: GroupStanding[] = gs.map((grp) => {
      const gTeams = tm.filter((tt) => tt.group_id === grp.id);
      const gM = gMatches.filter((m) => m.group_id === grp.id);
      const standings = computeStandings(gTeams, gM, pm).slice(0, apg);
      return { groupId: grp.id, groupName: grp.name, standings };
    });

    // Partition existing KO matches by bracket letter so each bracket can
    // advance independently.
    const koByBracket = new Map<string, TournamentMatch[]>();
    for (const m of koAll) {
      const b = m.bracket ?? "A";
      const arr = koByBracket.get(b) ?? [];
      arr.push(m);
      koByBracket.set(b, arr);
    }

    // Compute per-bracket seed-ordered team IDs. For multi-bracket data
    // (auto-mode with ≥16 advancing & divisible by 8) we use
    // `autoBracketSeedOrders` which slices the overall-ranked seed list into
    // 8-team chunks. For single-bracket data we preserve the legacy seeding
    // logic so already-running tournaments keep producing the same pairings.
    let seedOrdersByBracket: Map<string, string[]>;
    if (koByBracket.size > 1) {
      const qualified = buildQualifiedTeams(groupStandings, teamById);
      seedOrdersByBracket = autoBracketSeedOrders(groupStandings, qualified);
    } else {
      const soleBracket = koByBracket.keys().next().value ?? "A";
      let seedOrderedIds: string[];
      if (t.bracket_mode === "single") {
        const seeds = collectSeeds(groupStandings, apg);
        seedOrderedIds = seeds.map((s) => s.team_id);
      } else {
        const qualified = buildQualifiedTeams(groupStandings, teamById);
        seedOrderedIds = computeSeedOrder(qualified).map((q) => q.team_id);
      }
      seedOrdersByBracket = new Map([[soleBracket, seedOrderedIds]]);
    }

    function winnerOf(m: TournamentMatch): string {
      return (m.score_team1 ?? 0) > (m.score_team2 ?? 0) ? m.team1_id : m.team2_id;
    }
    function loserOf(m: TournamentMatch): string {
      return (m.score_team1 ?? 0) > (m.score_team2 ?? 0) ? m.team2_id : m.team1_id;
    }

    let generated = false;
    for (const [bracket, bracketMatches] of koByBracket) {
      const seedOrderedIds = seedOrdersByBracket.get(bracket) ?? [];
      if (seedOrderedIds.length < 2) continue;

      const byes = computeSeededByePairIndices(seedOrderedIds);
      const byeByPair = new Map(byes.map((b) => [b.pairIndex, b.teamId]));

      const koByRound = new Map<number, TournamentMatch[]>();
      for (const m of bracketMatches) {
        const arr = koByRound.get(m.round_number) ?? [];
        arr.push(m);
        koByRound.set(m.round_number, arr);
      }
      const sortedRounds = [...koByRound.keys()].sort((a, b) => a - b);
      if (sortedRounds.length === 0) continue;
      const firstRound = sortedRounds[0];

      for (const roundNum of sortedRounds) {
        const matchesThisRound = (koByRound.get(roundNum) ?? [])
          .slice()
          .sort((a, b) => {
            const dt = a.created_at.localeCompare(b.created_at);
            return dt !== 0 ? dt : a.id.localeCompare(b.id);
          });
        const nextRoundNum = roundNum + 1;
        const nextRoundMatches = allMatches.filter(
          (m) =>
            m.round_number === nextRoundNum &&
            m.stage !== "group" &&
            m.stage !== "bronze" &&
            (m.bracket ?? "A") === bracket
        );
        if (nextRoundMatches.length > 0) continue;
        if (!matchesThisRound.every((m) => m.status === "completed")) continue;

        let entrants: string[];
        if (roundNum === firstRound && byes.length > 0) {
          const pairCount = matchesThisRound.length + byes.length;
          entrants = new Array(pairCount);
          let mi = 0;
          for (let p = 0; p < pairCount; p++) {
            if (byeByPair.has(p)) {
              entrants[p] = byeByPair.get(p)!;
            } else {
              entrants[p] = winnerOf(matchesThisRound[mi++]);
            }
          }
        } else {
          entrants = matchesThisRound.map(winnerOf);
        }

        if (entrants.length < 2) continue;
        const M = entrants.length;
        const stage: MatchStage = M <= 2 ? "final" : M <= 4 ? "semi_final" : "quarter_final";

        const newMatches: Omit<TournamentMatch, "id" | "created_at">[] = [];
        for (let i = 0; i < M; i += 2) {
          const a = entrants[i];
          const b = entrants[i + 1];
          if (!a || !b) continue;
          const feederMatch = matchesThisRound.find(
            (mm) => winnerOf(mm) === a || winnerOf(mm) === b
          );
          const inherited =
            feederMatch?.court_id != null
              ? c.find((cc) => cc.id === feederMatch.court_id) ?? null
              : null;
          const court = inherited ?? c[(i / 2) % Math.max(1, c.length)] ?? null;
          newMatches.push({
            tournament_id: t.id,
            group_id: null,
            round_number: nextRoundNum,
            court_id: court?.id ?? null,
            team1_id: a,
            team2_id: b,
            score_team1: null,
            score_team2: null,
            status: "scheduled",
            stage,
            bracket,
          });
        }

        if (t.has_bronze && stage === "final" && matchesThisRound.length === 2) {
          const l1 = loserOf(matchesThisRound[0]);
          const l2 = loserOf(matchesThisRound[1]);
          const bronzeCourt = c[Math.floor(c.length / 2)] ?? c[0] ?? null;
          newMatches.push({
            tournament_id: t.id,
            group_id: null,
            round_number: nextRoundNum,
            court_id: bronzeCourt?.id ?? null,
            team1_id: l1,
            team2_id: l2,
            score_team1: null,
            score_team2: null,
            status: "scheduled",
            stage: "bronze",
            bracket,
          });
        }

        if (newMatches.length > 0) {
          await insertMatches(newMatches);
          generated = true;
        }
      }
    }

    return generated;
  }

  // Automatically generates the next KO round's match for each completed pair
  // of feeder matches, enabling QF and SF to run simultaneously. Multi-bracket:
  // KO matches are partitioned by `bracket` (A/B/C…) and each bracket advances
  // independently with its own external-bye set.
  async function autoAdvanceKO(loaded: Loaded): Promise<boolean> {
    const { tournament: t, courts: c, matches: allMatches, groups: g, teams: tm } = loaded;
    const koAll = allMatches.filter((m) => m.stage !== "group");
    if (koAll.length === 0) return false;
    if (t.formation === "seeded" || t.bracket_mode === "single") {
      return autoAdvanceSeededKO(loaded);
    }

    const completedNonBronze = koAll.filter(
      (m) => m.status === "completed" && m.stage !== "bronze"
    );
    if (completedNonBronze.length === 0) return false;

    const apg = t.advances_per_group ?? 0;
    const gMatches = allMatches.filter((m) => m.stage === "group");
    const pm = new Map<string, Player>();
    for (const p of loaded.players) pm.set(p.id, p);

    // Per-group advancing teams, ranked. Used to compute external byes per
    // bracket (rank N team from each group → bracket N+1 letter).
    const groupAdvancing: { groupId: string; advancing: string[] }[] = [];
    if (apg > 0) {
      for (const grp of g) {
        const gTeams = tm.filter((tt) => tt.group_id === grp.id);
        const gM = gMatches.filter((m) => m.group_id === grp.id);
        const standings = computeStandings(gTeams, gM, pm).slice(0, apg);
        groupAdvancing.push({
          groupId: grp.id,
          advancing: standings.map((s) => s.team_id),
        });
      }
    }
    const isSingleGroup = g.length <= 1;

    function externalByesFor(bracket: string, bracketMatches: TournamentMatch[]): string[] {
      const advancingIds = new Set<string>();
      if (isSingleGroup) {
        if (bracket === "A") {
          for (const ga of groupAdvancing) for (const id of ga.advancing) advancingIds.add(id);
        }
      } else {
        const rank = bracket.charCodeAt(0) - "A".charCodeAt(0);
        for (const ga of groupAdvancing) {
          if (rank >= 0 && rank < ga.advancing.length) advancingIds.add(ga.advancing[rank]);
        }
      }
      const playedInKO = new Set<string>(
        bracketMatches.flatMap((m) => [m.team1_id, m.team2_id])
      );
      return [...advancingIds].filter((id) => !playedInKO.has(id));
    }

    // Partition matches by bracket. Legacy rows with bracket=NULL are treated
    // as bracket "A" so existing tournaments keep working.
    const byBracket = new Map<string, TournamentMatch[]>();
    for (const m of koAll) {
      const b = m.bracket ?? "A";
      const arr = byBracket.get(b) ?? [];
      arr.push(m);
      byBracket.set(b, arr);
    }

    let generated = false;

    for (const [bracket, bracketMatches] of byBracket) {
      const externalByeIds = externalByesFor(bracket, bracketMatches);
      const allKORounds = [
        ...new Set(
          bracketMatches.filter((m) => m.stage !== "bronze").map((m) => m.round_number)
        ),
      ].sort((a, b) => a - b);
      const firstKORound = allKORounds[0] ?? 1;

      for (const roundNum of allKORounds) {
        const roundMatches = bracketMatches
          .filter((m) => m.round_number === roundNum && m.stage !== "bronze")
          .sort((a, b) => {
            const dt = a.created_at.localeCompare(b.created_at);
            return dt !== 0 ? dt : a.id.localeCompare(b.id);
          });
        const nextRound = roundNum + 1;
        const nextRoundMatches = bracketMatches.filter(
          (m) => m.round_number === nextRound && m.stage !== "bronze"
        );

        const relevantByeIds = roundNum === firstKORound ? externalByeIds : [];
        const n = roundMatches.length;

        if (relevantByeIds.length > 0) {
          if (!roundMatches.every((m) => m.status === "completed")) continue;
          if (nextRoundMatches.length > 0) continue;
          const next = generateNextKORound(
            roundMatches,
            relevantByeIds,
            c,
            t.id,
            t.has_bronze
          );
          if (next.length > 0) {
            await insertMatches(next);
            generated = true;
          }
          continue;
        }

        // No external byes: generate pair by pair as feeders complete.
        const newMatches: Omit<TournamentMatch, "id" | "created_at">[] = [];
        for (let i = 0; i < Math.floor(n / 2); i++) {
          const m1 = roundMatches[i];
          const m2 = roundMatches[n - 1 - i];
          if (m1.status !== "completed" || m2.status !== "completed") continue;

          const w1 = getKOWinnerId(m1);
          const w2 = getKOWinnerId(m2);
          if (w1 == null) throw new KOTieError(m1);
          if (w2 == null) throw new KOTieError(m2);

          const alreadyExists =
            nextRoundMatches.some(
              (m) =>
                (m.team1_id === w1 && m.team2_id === w2) ||
                (m.team1_id === w2 && m.team2_id === w1)
            ) ||
            newMatches.some(
              (m) =>
                (m.team1_id === w1 && m.team2_id === w2) ||
                (m.team1_id === w2 && m.team2_id === w1)
            );
          if (alreadyExists) continue;

          const nextTotal = Math.floor(n / 2);
          const stage: MatchStage =
            nextTotal === 1 ? "final" : nextTotal <= 2 ? "semi_final" : "quarter_final";
          const court = c.find((cc) => cc.id === m1.court_id) ?? c[i % Math.max(1, c.length)] ?? null;

          newMatches.push({
            tournament_id: t.id,
            group_id: null,
            round_number: nextRound,
            court_id: court?.id ?? null,
            team1_id: w1,
            team2_id: w2,
            score_team1: null,
            score_team2: null,
            status: "scheduled",
            stage,
            bracket,
          });

          if (t.has_bronze && stage === "final" && n === 2) {
            const l1 = getKOLoserId(m1);
            const l2 = getKOLoserId(m2);
            if (l1 == null) throw new KOTieError(m1);
            if (l2 == null) throw new KOTieError(m2);
            const bronzeCourt =
              c.find((cc) => cc.id === m2.court_id) ?? c[Math.floor(c.length / 2)] ?? c[0] ?? null;
            newMatches.push({
              tournament_id: t.id,
              group_id: null,
              round_number: nextRound,
              court_id: bronzeCourt?.id ?? null,
              team1_id: l1,
              team2_id: l2,
              score_team1: null,
              score_team2: null,
              status: "scheduled",
              stage: "bronze",
              bracket,
            });
          }
        }
        if (newMatches.length > 0) {
          await insertMatches(newMatches);
          generated = true;
        }
      }
    }
    return generated;
  }

  const [completing, setCompleting] = useState(false);
  const [completeErr, setCompleteErr] = useState<string | null>(null);
  const [koTieErr, setKOTieErr] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setPlayUrl(
      `${window.location.origin}/${tenant.slug}/tournament/${tournament.id}/play`
    );
  }, [tenant.slug, tournament.id]);
  const unpaidCount = useMemo(
    () => paymentRows.filter((r) => !r.paid).length,
    [paymentRows]
  );

  // Mirror the browser's fullscreen state into React so the header can swap
  // layout (centered logos + title) and the host view can overlay the tenant
  // nav (which lives in the parent layout and can't be removed from here).
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // User-gesture or permission failure — flip the local flag so the host
      // still gets the overlay layout even if real fullscreen is blocked.
      setIsFullscreen((v) => !v);
    }
  }

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
    setKOTieErr(null);
    try {
      await updateMatchScore(match.id, s1, s2, "completed");
      const loaded = await reload();
      if (match.stage !== "group" && loaded) {
        try {
          const generated = await autoAdvanceKO(loaded);
          if (generated) await reload();
        } catch (e) {
          if (e instanceof KOTieError) {
            setKOTieErr(e.message);
          } else {
            throw e;
          }
        }
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-40 overflow-auto bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
          : "min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
      }
    >
      <header
        className={`sticky top-0 z-10 px-6 py-3 flex items-center justify-between gap-4 relative ${
          isFullscreen && tournamentPhase === "done"
            ? "bg-transparent"
            : "border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
        }`}
      >
        <div className="min-w-0">
          {!isFullscreen && (
            <>
              <h1 className="text-xl font-semibold leading-tight">{tournament.name}</h1>
              <p className="text-xs text-zinc-500">
                {tenant.name} · {gamesLabel}
              </p>
            </>
          )}
        </div>

        {isFullscreen && tournamentPhase !== "done" && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-4 pointer-events-none">
            {tenant.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logo_url}
                alt=""
                className={`h-8 w-auto ${tenant.logo_url_dark ? "dark:hidden" : ""}`}
              />
            )}
            {tenant.logo_url_dark && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logo_url_dark}
                alt=""
                className={`h-8 w-auto ${tenant.logo_url ? "hidden dark:block" : ""}`}
              />
            )}
            <h1 className="text-xl font-semibold leading-tight whitespace-nowrap">
              {tournament.name}
            </h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/triad-logo.png" alt="Triad Solutions" className="h-8 w-auto dark:[filter:brightness(0)_invert(1)]" />
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {!isFullscreen &&
          (tournamentPhase === "ko_active" || tournamentPhase === "done") && koBracketProgress.length > 0 ? (
            koBracketProgress.map(({ bracket, completed, total, runningStage }) => (
              <div
                key={bracket}
                className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                <div
                  className="text-[10px] uppercase tracking-wide leading-none mb-0.5 font-semibold"
                  style={{ color: koStageBadgeColor(runningStage ?? "final") }}
                >
                  {bracketLabelAuto(bracket, hasMultipleBrackets)}
                  {runningStage && (
                    <span className="text-zinc-400 font-normal ml-1">
                      · {KO_STAGE_LABEL[runningStage] ?? runningStage}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold tabular-nums leading-tight">
                  {completed}
                  <span className="text-zinc-400 font-normal">/{total}</span>
                  <span className="text-zinc-500 font-normal text-[11px] ml-1">klara</span>
                </div>
              </div>
            ))
          ) : null}
          {!isFullscreen && (
            <div className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 leading-none mb-0.5">
                Totalt
              </div>
              <div className="text-sm font-semibold tabular-nums leading-tight">
                {completedCount}
                <span className="text-zinc-400 font-normal">/{totalMatches}</span>
              </div>
            </div>
          )}
          {!isFullscreen && (
          <button
            type="button"
            onClick={() => setPaymentOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 text-zinc-500"
              aria-hidden
            >
              <path d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1H2V5Zm0 4h16v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9Zm3 3a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H5Z" />
            </svg>
            Betalning
            {unpaidCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-bold tabular-nums">
                {unpaidCount}
              </span>
            )}
          </button>
          )}
          {tournament.status === "active" &&
            tournament.format === "gruppspel" && (
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                aria-label="QR-kod för mobilrapportering"
                title="QR-kod för mobilrapportering"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-zinc-500"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <path d="M14 14h3v3h-3zM20 14h1v1h-1zM14 20h3v1h-3zM20 17h1v4M17 20h3" />
                </svg>
                <span className="hidden sm:inline">QR-kod</span>
              </button>
            )}
          {!isFullscreen && tournament.status === "active" && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Inställningar"
              title="Inställningar"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-zinc-500"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
              <span className="hidden sm:inline">Inställningar</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? "Avsluta helskärm" : "Helskärm"}
            title={isFullscreen ? "Avsluta helskärm" : "Helskärm"}
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {isFullscreen ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-zinc-500"
                aria-hidden="true"
              >
                <path d="M9 9H4M9 9V4M15 9h5M15 9V4M9 15H4M9 15v5M15 15h5M15 15v5" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-zinc-500"
                aria-hidden="true"
              >
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            )}
          </button>
          {!isFullscreen && (
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
              <span className="hidden sm:inline">Öppna TV-visning</span>
            </Link>
          )}
        </div>
      </header>

      {koTieErr && (
        <div className="border-b border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-5 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Slutspelet kan inte avancera:</span>{" "}
            {koTieErr} Justera resultatet så fortsätter slutspelet automatiskt.
          </div>
          <button
            onClick={() => setKOTieErr(null)}
            className="shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
          >
            Stäng
          </button>
        </div>
      )}

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

      {tournamentPhase === "done" && tournament.status !== "completed" && !isFullscreen && (
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

      {winners && winners.length > 0 && (
        <WinnerTable
          tenant={tenant}
          tournament={tournament}
          winners={winners.slice(0, 1)}
          teamMap={teamMap}
          playerMap={playerMap}
          hasMultipleBrackets={hasMultipleBrackets}
          accent={accent}
          isFullscreen={isFullscreen}
        />
      )}

      {tournamentPhase === "ready_for_playoff" && (
        <PlayoffPanel
          tournament={tournament}
          groupStandings={groupStandings}
          courts={courts}
          accent={accent}
          teamMap={teamMap}
          playerMap={playerMap}
          onGenerated={reload}
        />
      )}

      <main className={`px-5 py-4 ${isFullscreen && tournamentPhase === "done" ? "hidden" : ""}`}>
        {!hasKO ? (
          <>
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
                    restingTeamIds={restingTeamIdsThisRound}
                    bracketByTeamId={bracketByTeamId}
                    gamesPerMatch={g.games_per_match ?? tournament.games_per_match}
                    onSave={saveScore}
                    busyId={busy}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            {tournamentPhase !== "done" && (
              <KOResultsPanel
                koMatches={koMatches}
                teamMap={teamMap}
                playerMap={playerMap}
                hasMultipleBrackets={hasMultipleBrackets}
              />
            )}
            {sortedBrackets.length === 0 ? (
              <div className="text-sm text-zinc-500">Inga slutspelsmatcher.</div>
            ) : (
              <div
                className="grid gap-3 items-start overflow-x-auto"
                style={{
                  gridTemplateColumns: `repeat(${sortedBrackets.length}, minmax(320px, 1fr))`,
                }}
              >
                {sortedBrackets.map((bracket) => (
                  <BracketSection
                    key={bracket}
                    bracket={bracket}
                    hasMultipleBrackets={hasMultipleBrackets}
                    bracketMatches={koByBracket.get(bracket) ?? []}
                    progress={
                      koBracketProgress.find((p) => p.bracket === bracket) ?? {
                        bracket,
                        completed: 0,
                        total: 0,
                        runningStage: null,
                      }
                    }
                    courts={courts}
                    teamMap={teamMap}
                    playerMap={playerMap}
                    groupIndexMap={groupIndexMap}
                    matchDisplayStageLabel={matchDisplayStageLabel}
                    saveScore={saveScore}
                    busy={busy}
                    gamesPerMatch={tournament.games_per_match}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {paymentOpen && (
        <PaymentModal onClose={() => setPaymentOpen(false)}>
          <PaymentPanel
            players={paymentRows}
            accent={tenant.primary_color || "#10b981"}
            onSetPaid={handleSetPaid}
          />
        </PaymentModal>
      )}

      {qrOpen && playUrl && (
        <QrCodeModal url={playUrl} onClose={() => setQrOpen(false)} />
      )}

      {settingsOpen && (
        <SessionSettingsModal onClose={() => setSettingsOpen(false)}>
          <SessionSettingsPanel
            tournament={tournament}
            courts={courts}
            matches={matches}
            accent={tenant.primary_color || "#10b981"}
            onSaved={async () => {
              setSettingsOpen(false);
              await reload();
            }}
          />
        </SessionSettingsModal>
      )}
    </div>
  );
}

// --- PlayoffPanel ---
// Shown when: all group play done + no KO matches yet (ready_for_playoff)
// OR: a KO round just finished and there's a next round to generate.

// Multi-bracket starter: generates the first round of every slutspel
// (A-slutspel, B-slutspel, …) at once. Subsequent rounds are produced by
// autoAdvanceKO when feeder matches finish.
function PlayoffPanel({
  tournament,
  groupStandings,
  courts,
  accent,
  teamMap,
  playerMap,
  onGenerated,
}: {
  tournament: Tournament;
  groupStandings: GroupStanding[];
  courts: Court[];
  accent: string;
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onGenerated: () => Promise<any>;
}) {
  const hasBronze = tournament.has_bronze;
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isLegacySplit = tournament.bracket_mode === "split";
  const isLegacySeeded = tournament.formation === "seeded";
  // Preview every bracket's first-round matchups, regardless of court selection.
  const previewMatchups = useMemo(() => {
    if (isLegacySplit) {
      return generateFirstKORound(groupStandings, [], [], tournament.id, hasBronze);
    }
    if (isLegacySeeded) {
      const qualified = buildQualifiedTeams(groupStandings, teamMap);
      return generateSeededFirstRound(qualified, [], tournament.id, "A");
    }
    const qualified = buildQualifiedTeams(groupStandings, teamMap);
    return generateAutoFirstRound(groupStandings, qualified, [], tournament.id);
  }, [
    groupStandings,
    tournament.id,
    isLegacySplit,
    isLegacySeeded,
    hasBronze,
    teamMap,
  ]);

  // Per-team bracket assignment for the standings preview. For legacy split
  // mode this maps group-rank → bracket letter; for the new auto path it
  // mirrors `autoBracketSeedOrders` so the host sees which slutspel each
  // advancing team will land in.
  const bracketByTeamId = useMemo(() => {
    const out = new Map<string, string>();
    if (isLegacySplit) {
      for (const g of groupStandings) {
        g.standings.forEach((s, rank) => {
          out.set(s.team_id, bracketLetter(rank));
        });
      }
      return out;
    }
    if (isLegacySeeded) {
      for (const g of groupStandings) {
        for (const s of g.standings) out.set(s.team_id, "A");
      }
      return out;
    }
    const qualified = buildQualifiedTeams(groupStandings, teamMap);
    const seeds = autoBracketSeedOrders(groupStandings, qualified);
    for (const [letter, ids] of seeds) {
      for (const id of ids) out.set(id, letter);
    }
    return out;
  }, [groupStandings, isLegacySplit, isLegacySeeded, teamMap]);

  // One bracket entry per slutspel, summarising team count + matchups.
  type BracketPreview = {
    bracket: string;
    matches: typeof previewMatchups;
    teams: number;
  };
  const previewByBracket = useMemo<BracketPreview[]>(() => {
    const map = new Map<string, BracketPreview>();
    for (const m of previewMatchups) {
      const b = m.bracket ?? "A";
      let entry = map.get(b);
      if (!entry) {
        entry = { bracket: b, matches: [], teams: 0 };
        map.set(b, entry);
      }
      entry.matches.push(m);
    }
    // Team count per bracket — derived from per-team assignments so it's
    // consistent across legacy and auto paths.
    for (const [, letter] of bracketByTeamId) {
      const entry = map.get(letter);
      if (entry) entry.teams += 1;
    }
    // Single-bracket fallback when no matches yet were produced for a letter
    // (e.g. <2 advancing teams).
    if (map.size === 0 && bracketByTeamId.size > 0) {
      const teams = bracketByTeamId.size;
      map.set("A", { bracket: "A", matches: [], teams });
    }
    return [...map.values()].sort((a, b) => a.bracket.localeCompare(b.bracket));
  }, [previewMatchups, bracketByTeamId]);

  const hasMultipleBrackets = previewByBracket.length > 1;

  const recommendedCount = previewMatchups.length;

  // Courts were already chosen during tournament setup — auto-allocate the
  // first N courts (one per playoff match) so the host doesn't have to pick
  // them again. Fewer than recommended is fine; matches without a court are
  // queued and assigned as courts free up.
  const chosenCourts = useMemo(
    () => courts.slice(0, Math.max(1, recommendedCount)),
    [courts, recommendedCount]
  );
  const canGenerate = chosenCourts.length > 0 && previewMatchups.length > 0;

  async function generate() {
    if (!canGenerate) return;
    setErr(null);
    setGenerating(true);
    try {
      const newMatches = isLegacySplit
        ? generateFirstKORound(
            groupStandings,
            [],
            chosenCourts,
            tournament.id,
            hasBronze
          )
        : isLegacySeeded
          ? generateSeededFirstRound(
              buildQualifiedTeams(groupStandings, teamMap),
              chosenCourts,
              tournament.id,
              "A"
            )
          : generateAutoFirstRound(
              groupStandings,
              buildQualifiedTeams(groupStandings, teamMap),
              chosenCourts,
              tournament.id
            );
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
          Starta slutspel
        </span>
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {previewByBracket.length > 1
            ? `${previewByBracket.length} slutspel genereras parallellt`
            : "Slutspel"}
        </h2>
      </div>

      {err && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {/* Group standings with advancing teams highlighted */}
      <div
        className="mb-4 grid gap-3"
        style={{ gridTemplateColumns: `repeat(${groupStandings.length}, minmax(0, 1fr))` }}
      >
        {groupStandings.map((g, gi) => {
          const palette = groupPaletteFor(gi);
          return (
            <div key={g.groupId} className="rounded-lg border overflow-hidden">
              <div className={`px-3 py-1.5 text-xs font-semibold ${palette.bar}`}>
                {g.groupName} — vidare
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {g.standings.map((s, i) => {
                  const t = teamMap.get(s.team_id);
                  const letter = bracketByTeamId.get(s.team_id);
                  return (
                    <div
                      key={s.team_id}
                      className="px-3 py-1.5 flex items-center gap-2 justify-between"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-zinc-400 w-4">{i + 1}</span>
                        <span className="text-xs font-medium truncate">
                          {t ? shortTeamName(t, playerMap) : s.teamName}
                        </span>
                      </div>
                      {hasMultipleBrackets && letter && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400">
                          → {letter}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-bracket preview */}
      {previewByBracket.length > 0 && (
        <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${previewByBracket.length}, minmax(0, 1fr))` }}>
          {previewByBracket.map((b) => {
            const path = computeBracketPath(b.teams, hasBronze);
            return (
              <div key={b.bracket} className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between gap-2">
                  <span>{bracketLabelAuto(b.bracket, hasMultipleBrackets)}</span>
                  <span className="text-zinc-400 font-normal">{b.teams} lag</span>
                </div>
                {path.length > 0 && (
                  <div className="px-3 pt-2 flex items-center gap-1 flex-wrap text-[10px]">
                    {path.map((step, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-zinc-300">→</span>}
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            step.isNow
                              ? "text-white"
                              : "text-zinc-500 bg-zinc-100 dark:bg-zinc-800"
                          }`}
                          style={
                            step.isNow
                              ? {
                                  backgroundColor: koStageBadgeColor(
                                    step.label === "Kvartsfinal"
                                      ? "quarter_final"
                                      : step.label === "Semifinal"
                                      ? "semi_final"
                                      : step.label === "Final"
                                      ? "final"
                                      : step.label === "Bronsmatch"
                                      ? "bronze"
                                      : "quarter_final"
                                  ),
                                }
                              : undefined
                          }
                        >
                          {step.label}
                          {step.matchCount > 1 ? ` ×${step.matchCount}` : ""}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 mt-1">
                  {b.matches.map((m, i) => {
                    const t1 = teamMap.get(m.team1_id);
                    const t2 = teamMap.get(m.team2_id);
                    return (
                      <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                        <span className="font-medium truncate flex-1 text-right">
                          {t1 ? shortTeamName(t1, playerMap) : "?"}
                        </span>
                        <span className="text-zinc-400 shrink-0">vs</span>
                        <span className="font-medium truncate flex-1">
                          {t2 ? shortTeamName(t2, playerMap) : "?"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={generate}
        disabled={!canGenerate || generating}
        className="px-5 py-2 rounded-md text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: accent }}
      >
        {generating ? "Genererar..." : "Starta slutspel →"}
      </button>
    </div>
  );
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

  // Treat an empty input as 0 so that e.g. typing only "5" submits as 5-0.
  // Both-empty (0-0) is still rejected by the draw check below.
  const a = s1 === "" ? 0 : parseInt(s1, 10);
  const b = s2 === "" ? 0 : parseInt(s2, 10);
  const aFilled = !Number.isNaN(a);
  const bFilled = !Number.isNaN(b);
  const bothFilled = aFilled && bFilled;
  const userTouched = s1 !== "" || s2 !== "";

  let validationMsg: string | null = null;
  if (!userTouched) {
    validationMsg = null;
  } else if (aFilled && (a < 0 || a > gamesPerMatch)) {
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
      <div className="flex justify-between items-center mb-2 gap-2">
        <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
          {courtName}
        </span>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">
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

// Shows completed KO match results, grouped by bracket then by stage.
type WinnerPodiumRow = {
  bracket: string | null;
  first: string | null;
};

function WinnerTable({
  tenant,
  tournament,
  winners,
  teamMap,
  playerMap,
  hasMultipleBrackets,
  accent,
  isFullscreen,
}: {
  tenant: Tenant;
  tournament: Tournament;
  winners: WinnerPodiumRow[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  hasMultipleBrackets: boolean;
  accent: string;
  isFullscreen: boolean;
}) {
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    const t = teamMap.get(id);
    return t ? shortTeamName(t, playerMap) : null;
  };

  const showBracketLabel = winners.length > 1 || winners[0]?.bracket != null;

  const dateString = (() => {
    const iso = tournament.scheduled_at ?? tournament.created_at;
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return null;
    }
  })();

  return (
    <div
      className={`relative border-b border-amber-200/40 dark:border-zinc-800 bg-gradient-to-b from-amber-50/90 via-white to-amber-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 ${
        isFullscreen ? "min-h-[calc(100vh-4rem)] flex flex-col justify-center" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute inset-x-0 -top-[8rem] sm:-top-[10rem] h-[34rem] bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.34),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.24),transparent_65%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(to_top,rgba(251,191,36,0.06),transparent)] dark:bg-[linear-gradient(to_top,rgba(251,191,36,0.05),transparent)]"
        aria-hidden
      />

      <div className="relative px-6 pt-10 pb-10 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-center gap-6 sm:gap-10 mb-6">
          {tenant.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className={`h-16 sm:h-24 w-auto object-contain ${tenant.logo_url_dark ? "dark:hidden" : ""}`}
            />
          )}
          {tenant.logo_url_dark && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo_url_dark}
              alt={tenant.name}
              className={`h-16 sm:h-24 w-auto object-contain ${tenant.logo_url ? "hidden dark:block" : ""}`}
            />
          )}
          {(tenant.logo_url || tenant.logo_url_dark) && (
            <span
              className="h-12 sm:h-16 w-px bg-zinc-300 dark:bg-zinc-700"
              aria-hidden
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/triad-logo.png"
            alt="Triad Solutions"
            className="h-16 sm:h-24 w-auto object-contain dark:[filter:brightness(0)_invert(1)]"
          />
        </div>

        <div className="flex items-center justify-center gap-3 mb-3">
          <span
            className="h-px w-16 sm:w-24"
            style={{ background: `linear-gradient(to right, transparent, ${accent}aa)` }}
            aria-hidden
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-7 h-7 sm:w-9 sm:h-9 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          >
            <path d="M6 9H4a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1h3" />
            <path d="M18 9h2a2 2 0 0 0 2-2V5a1 1 0 0 0-1-1h-3" />
            <path d="M6 4h12v7a6 6 0 0 1-12 0V4Z" />
            <path d="M12 17v4" />
            <path d="M8 21h8" />
          </svg>
          <span
            className="text-xl sm:text-3xl md:text-4xl font-black uppercase tracking-[0.3em] text-amber-700 dark:text-amber-300"
          >
            Resultat
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-7 h-7 sm:w-9 sm:h-9 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          >
            <path d="M6 9H4a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1h3" />
            <path d="M18 9h2a2 2 0 0 0 2-2V5a1 1 0 0 0-1-1h-3" />
            <path d="M6 4h12v7a6 6 0 0 1-12 0V4Z" />
            <path d="M12 17v4" />
            <path d="M8 21h8" />
          </svg>
          <span
            className="h-px w-16 sm:w-24"
            style={{ background: `linear-gradient(to left, transparent, ${accent}aa)` }}
            aria-hidden
          />
        </div>

        <h2 className="text-center text-base sm:text-lg md:text-xl font-semibold tracking-tight text-zinc-700 dark:text-zinc-300 leading-tight">
          {tournament.name}
        </h2>

        <p className="text-center text-sm sm:text-base text-zinc-500 dark:text-zinc-400 mt-2 font-medium">
          {tenant.name}
          {dateString ? ` · ${dateString}` : null}
        </p>

        <div
          className="relative grid gap-10 mt-10"
          style={{
            gridTemplateColumns: `repeat(${winners.length}, minmax(0, 1fr))`,
          }}
        >
          {winners.map((w) => {
            const first = nameOf(w.first);
            return (
              <div
                key={w.bracket ?? "main"}
                className="flex flex-col items-center"
              >
                {showBracketLabel && (
                  <div
                    className="text-[10px] sm:text-xs uppercase tracking-[0.28em] font-black mb-6 px-4 py-1.5 rounded-full border"
                    style={{
                      borderColor: `${accent}55`,
                      color: accent,
                      backgroundColor: `${accent}10`,
                    }}
                  >
                    {w.bracket
                      ? bracketLabelAuto(w.bracket, hasMultipleBrackets)
                      : "Slutställning"}
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/icons/icon-trophy.svg"
                  alt=""
                  aria-hidden="true"
                  className="w-40 h-40 sm:w-56 sm:h-56 md:w-64 md:h-64 drop-shadow-[0_18px_36px_rgba(245,158,11,0.45)]"
                />
                <div className="mt-6 text-[10px] sm:text-xs uppercase tracking-[0.32em] font-black text-amber-700 dark:text-amber-300">
                  Vinnare
                </div>
                <div className="mt-3 text-3xl sm:text-5xl md:text-6xl font-black text-zinc-900 dark:text-zinc-50 text-center leading-tight break-words max-w-full px-2">
                  {first ?? "–"}
                </div>
                <div
                  className="w-full max-w-lg h-1.5 mt-8 rounded-b bg-gradient-to-r from-transparent via-zinc-300 to-transparent dark:via-zinc-700"
                  aria-hidden
                />
                <div
                  className="w-full max-w-md h-6 mt-0 rounded-b-full bg-gradient-to-b from-zinc-200/60 to-transparent dark:from-zinc-800/60 dark:to-transparent blur-sm"
                  aria-hidden
                />
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

function KOResultsPanel({
  koMatches,
  teamMap,
  playerMap,
  hasMultipleBrackets,
}: {
  koMatches: TournamentMatch[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  hasMultipleBrackets: boolean;
}) {
  const completed = koMatches.filter((m) => m.status === "completed");
  if (completed.length === 0) return null;

  const byBracket = new Map<string, TournamentMatch[]>();
  for (const m of completed) {
    const b = m.bracket ?? "A";
    const arr = byBracket.get(b) ?? [];
    arr.push(m);
    byBracket.set(b, arr);
  }
  const sortedBrackets = [...byBracket.keys()].sort();

  const stageOrder: MatchStage[] = ["bronze", "final", "semi_final", "quarter_final"];

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 font-medium text-sm text-zinc-700 dark:text-zinc-300">
        Slutspelsresultat
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${sortedBrackets.length}, minmax(0, 1fr))`,
        }}
      >
        {sortedBrackets.map((bracket) => {
          const grouped = stageOrder
            .map((stage) => ({
              stage,
              matches: (byBracket.get(bracket) ?? []).filter((m) => m.stage === stage),
            }))
            .filter((g) => g.matches.length > 0);
          return (
            <div
              key={bracket}
              className="border-r last:border-r-0 border-zinc-100 dark:border-zinc-800"
            >
              <div className="px-3 py-1.5 text-xs font-semibold border-b border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200">
                {bracketLabelAuto(bracket, hasMultipleBrackets)}
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
                        <div
                          key={m.id}
                          className="px-3 py-1.5 flex items-center gap-2 text-xs"
                        >
                          <span
                            className={`flex-1 truncate font-medium ${
                              t1Wins ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"
                            }`}
                          >
                            {t1 ? shortTeamName(t1, playerMap) : "?"}
                          </span>
                          <span className="tabular-nums font-bold shrink-0 text-zinc-700 dark:text-zinc-300">
                            {m.score_team1 ?? "–"}–{m.score_team2 ?? "–"}
                          </span>
                          <span
                            className={`flex-1 truncate font-medium text-right ${
                              !t1Wins ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"
                            }`}
                          >
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
        })}
      </div>
    </div>
  );
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
        className="h-3 w-8 rounded-t border border-b-0 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center"
      >
        <svg viewBox="0 0 10 6" className="w-2 h-1" aria-hidden>
          <path d="M0 6 L5 0 L10 6 Z" fill="currentColor" />
        </svg>
      </button>
      <div className="h-5 w-8 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-sm font-bold tabular-nums">
        {value}
      </div>
      <button
        type="button"
        aria-label={`${ariaLabel} minska`}
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={disabled || value <= 0}
        className="h-3 w-8 rounded-b border border-t-0 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center"
      >
        <svg viewBox="0 0 10 6" className="w-2 h-1" aria-hidden>
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
  compact = false,
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
  compact?: boolean;
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

  // Compact single-line row used for past (completed) and future (blocked)
  // rounds. Edit on a past row pops the user back into the full editor.
  if (compact && !showInputs) {
    return (
      <div
        className={`px-3 py-1 flex items-center gap-2 text-xs ${
          isBlocked ? "opacity-60" : ""
        }`}
      >
        {courtName && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {courtName}
          </span>
        )}
        <span
          className="flex-1 min-w-0 text-right truncate"
          title={team1Label}
        >
          {team1Label}
        </span>
        {isCompleted ? (
          <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/60 font-bold tabular-nums">
            <span
              className={
                (match.score_team1 ?? 0) > (match.score_team2 ?? 0)
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-zinc-400"
              }
            >
              {match.score_team1 ?? "–"}
            </span>
            <span className="text-zinc-400">–</span>
            <span
              className={
                (match.score_team2 ?? 0) > (match.score_team1 ?? 0)
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-zinc-400"
              }
            >
              {match.score_team2 ?? "–"}
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-zinc-400">vs</span>
        )}
        <span
          className="flex-1 min-w-0 text-left truncate"
          title={team2Label}
        >
          {team2Label}
        </span>
        <span className="shrink-0 flex items-center">
          {isCompleted ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Redigera resultat"
              title="Redigera resultat"
              className="h-6 w-6 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3 h-3"
                aria-hidden
              >
                <path d="M2.695 14.762l-1.262 3.155a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.886L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.419a4 4 0 0 0-.885 1.343Z" />
              </svg>
            </button>
          ) : (
            <span
              aria-hidden
              className="h-6 w-6 flex items-center justify-center text-amber-500"
              title={reason ?? "Låst"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3 h-3"
              >
                <path
                  fillRule="evenodd"
                  d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className={`px-3 py-1 ${isBlocked ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""}`}>
      <div className="flex items-center gap-2">
        {courtName && (
          <span className="shrink-0 px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
            {courtName}
          </span>
        )}
        <span
          className="flex-1 min-w-0 text-right text-sm font-medium truncate"
          title={team1Label}
        >
          {team1Label}
        </span>

        {showInputs ? (
          <div className="flex items-center gap-1 shrink-0">
            <ScoreStepper
              value={s1}
              onChange={setS1}
              disabled={busy}
              max={gamesPerMatch}
              ariaLabel={team1Label}
            />
            <span className="text-zinc-400 text-xs">–</span>
            <ScoreStepper
              value={s2}
              onChange={setS2}
              disabled={busy}
              max={gamesPerMatch}
              ariaLabel={team2Label}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/60 font-bold tabular-nums text-sm">
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
            <span className="text-zinc-400 text-xs">–</span>
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
              className="px-2 h-7 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "…" : "Klar"}
            </button>
          ) : isCompleted ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Redigera resultat"
              title="Redigera resultat"
              className="h-7 w-7 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5"
                aria-hidden
              >
                <path d="M2.695 14.762l-1.262 3.155a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.886L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.419a4 4 0 0 0-.885 1.343Z" />
              </svg>
            </button>
          ) : (
            <span
              aria-hidden
              className="h-7 w-7 flex items-center justify-center text-amber-500"
              title={reason ?? "Låst"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5"
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

      {((isBlocked && reason) || (isCompleted && editing)) && (
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400 pl-1">
          {isBlocked && reason && (
            <span className="text-amber-600 dark:text-amber-400 font-medium truncate">
              {reason}
            </span>
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
      )}
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
  restingTeamIds,
  bracketByTeamId,
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
  restingTeamIds: string[];
  bracketByTeamId: Map<string, string>;
  gamesPerMatch: number;
  onSave: (m: TournamentMatch, s1: number, s2: number) => Promise<void>;
  busyId: string | null;
}) {
  const palette = groupPaletteFor(paletteIndex);
  const restingSet = useMemo(() => new Set(restingTeamIds), [restingTeamIds]);

  const matchesByRound = useMemo(() => {
    const map = new Map<number, TournamentMatch[]>();
    for (const m of groupMatches) {
      const arr = map.get(m.round_number) ?? [];
      arr.push(m);
      map.set(m.round_number, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [groupMatches]);

  // Lowest round number with at least one unfinished match — visually
  // emphasized so the host always sees what's playable now.
  const currentRound = useMemo(() => {
    let r: number | null = null;
    for (const m of groupMatches) {
      if (m.status !== "completed") {
        if (r === null || m.round_number < r) r = m.round_number;
      }
    }
    return r;
  }, [groupMatches]);

  // Render order: current round at the top, future rounds next (ascending),
  // and past completed rounds last so the active match is always the first
  // thing the host sees.
  const orderedRounds = useMemo(() => {
    if (currentRound === null) return matchesByRound;
    const current = matchesByRound.find(([r]) => r === currentRound);
    const future = matchesByRound.filter(([r]) => r > currentRound);
    const past = matchesByRound.filter(([r]) => r < currentRound);
    return [...(current ? [current] : []), ...future, ...past];
  }, [matchesByRound, currentRound]);

  const standings = useMemo(
    () => computeStandings(groupTeams, groupMatches, playerMap),
    [groupTeams, groupMatches, playerMap]
  );

  const groupComplete = useMemo(
    () => groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed"),
    [groupMatches]
  );

  const hasMultipleBrackets = useMemo(() => {
    const letters = new Set<string>();
    for (const [, letter] of bracketByTeamId) letters.add(letter);
    return letters.size > 1;
  }, [bracketByTeamId]);

  return (
    <div className={`rounded-lg border ${palette.border} border-l-4 ${palette.spine} ${palette.panel} overflow-hidden flex flex-col min-w-0`}>
      <div className={`px-4 py-2 font-semibold text-sm ${palette.solidBar} flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold tabular-nums ${palette.numberBadge}`}
            aria-hidden="true"
          >
            {paletteIndex + 1}
          </span>
          <span className="truncate">{group.name}</span>
        </div>
        {groupComplete && (
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/60"
            title="Alla matcher i gruppen är spelade"
          >
            Gruppspel klart
          </span>
        )}
      </div>

      {/* Standings (scoreboard) at the top of the column */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 bg-zinc-50/60 dark:bg-zinc-900/40">
            <tr>
              <th className="px-2 py-1 w-7">#</th>
              <th className="text-left px-2 py-1 font-medium">Lag</th>
              <th className="px-1 py-1">
                <abbr
                  title="Matcher spelade"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  MP
                </abbr>
              </th>
              <th className="px-1 py-1">
                <abbr
                  title="Vunna game"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  GF
                </abbr>
              </th>
              <th className="px-1 py-1">
                <abbr
                  title="Förlorade game"
                  className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
                >
                  GA
                </abbr>
              </th>
              <th className="px-1 py-1">
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
              const bracketLetterForTeam = bracketByTeamId.get(s.team_id) ?? null;
              const slutspelTitle = bracketLetterForTeam
                ? `Går vidare till ${bracketLabelAuto(bracketLetterForTeam, hasMultipleBrackets)}`
                : null;
              const isResting = !groupComplete && restingSet.has(s.team_id);
              return (
                <tr
                  key={s.team_id}
                  className={`border-t border-zinc-100 dark:border-zinc-800 ${bracketLetterForTeam ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""}`}
                >
                  <td className="px-2 py-1 text-center text-zinc-500">
                    {i + 1}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="font-medium truncate"
                        title={t ? teamName(t, playerMap) : s.teamName}
                      >
                        {t ? shortTeamName(t, playerMap) : s.teamName}
                      </span>
                      {isResting && (
                        <span
                          className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300 px-1 py-px rounded bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-800/60"
                          title="Vilar denna omgång"
                          aria-label="Vilar denna omgång"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="w-2.5 h-2.5"
                            aria-hidden
                          >
                            <path d="M4 3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v14a1 1 0 0 1-2 0v-3.34l6.62-1.84a1 1 0 0 1 1.16.5l.34.68a1 1 0 0 0 1.51.32L17 10.5a1 1 0 0 0-.41-1.74L11 7.5V4a1 1 0 0 0-1.55-.83l-2.45 1.61V3Z" />
                          </svg>
                          Vilar
                        </span>
                      )}
                      {bracketLetterForTeam && (
                        <span
                          className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 px-1 py-px rounded bg-emerald-100/60 dark:bg-emerald-950/40"
                          title={slutspelTitle ?? undefined}
                        >
                          {bracketLetterForTeam}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-1 text-center">{s.mp}</td>
                  <td className="px-1 py-1 text-center">{s.gf}</td>
                  <td className="px-1 py-1 text-center">{s.ga}</td>
                  <td className="px-1 py-1 text-center font-semibold">
                    {s.gd > 0 ? `+${s.gd}` : s.gd}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Matches grouped by round. Past/future rounds render compact; the
          current round gets full-size match rows with steppers. */}
      <div>
        {orderedRounds.length === 0 && (
          <div className="px-4 py-3 text-xs text-zinc-500">Inga matcher.</div>
        )}
        {orderedRounds.map(([round, ms]) => {
          const isCurrent = currentRound !== null && round === currentRound;
          const isPast = currentRound === null || round < (currentRound ?? Infinity);
          return (
            <div key={round}>
              <div
                className={
                  isCurrent
                    ? "px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border-y border-emerald-200 dark:border-emerald-900/40 flex items-center gap-1.5"
                    : "px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 bg-zinc-50/40 dark:bg-zinc-900/40 border-y border-zinc-100 dark:border-zinc-800/60"
                }
              >
                <span>Omgång {round}</span>
                {isCurrent ? (
                  <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal text-emerald-700/80 dark:text-emerald-400/80">
                    pågår
                  </span>
                ) : isPast ? (
                  <span className="ml-auto text-[9px] font-medium normal-case tracking-normal text-zinc-400">
                    klar
                  </span>
                ) : (
                  <span className="ml-auto text-[9px] font-medium normal-case tracking-normal text-zinc-400">
                    kommande
                  </span>
                )}
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
                      compact={!isCurrent}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Renders one bracket's column during KO phase: header (bracket name +
// progress) and a list of matches grouped by stage, one card per active
// match per court. Completed matches show in KOResultsPanel (above).
function BracketSection({
  bracket,
  hasMultipleBrackets,
  bracketMatches,
  progress,
  courts,
  teamMap,
  playerMap,
  groupIndexMap,
  matchDisplayStageLabel,
  saveScore,
  busy,
  gamesPerMatch,
}: {
  bracket: string;
  hasMultipleBrackets: boolean;
  bracketMatches: TournamentMatch[];
  progress: { bracket: string; completed: number; total: number; runningStage: MatchStage | null };
  courts: Court[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  groupIndexMap: Map<string, number>;
  matchDisplayStageLabel: (m: TournamentMatch) => string;
  saveScore: (m: TournamentMatch, s1: number, s2: number) => Promise<void>;
  busy: string | null;
  gamesPerMatch: number;
}) {
  const stageOrder: MatchStage[] = ["quarter_final", "semi_final", "final", "bronze"];

  // Active match per court for this bracket: the lowest-round incomplete match.
  const activeByCourt = useMemo(() => {
    const map = new Map<string, TournamentMatch>();
    for (const m of bracketMatches) {
      if (m.status === "completed") continue;
      if (!m.court_id) continue;
      const prev = map.get(m.court_id);
      if (!prev || m.round_number < prev.round_number) {
        map.set(m.court_id, m);
      }
    }
    return map;
  }, [bracketMatches]);

  // Group active matches by stage so they render under stage headers.
  const matchesByStage = useMemo(() => {
    const buckets = new Map<MatchStage, { court: Court; match: TournamentMatch }[]>();
    for (const c of courts) {
      const m = activeByCourt.get(c.id);
      if (!m) continue;
      const arr = buckets.get(m.stage) ?? [];
      arr.push({ court: c, match: m });
      buckets.set(m.stage, arr);
    }
    return buckets;
  }, [courts, activeByCourt]);

  const allDone = bracketMatches.length > 0 && bracketMatches.every((m) => m.status === "completed");

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col min-w-0">
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{bracketLabelAuto(bracket, hasMultipleBrackets)}</h3>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 shrink-0">
          {progress.runningStage && (
            <span
              className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-wide text-white"
              style={{ backgroundColor: koStageBadgeColor(progress.runningStage) }}
            >
              {KO_STAGE_LABEL[progress.runningStage] ?? progress.runningStage}
            </span>
          )}
          <span className="tabular-nums font-semibold">
            {progress.completed}
            <span className="text-zinc-400 font-normal">/{progress.total}</span>
          </span>
        </div>
      </div>
      <div className="p-3 space-y-3">
        {allDone ? (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
            Slutspelet är klart.
          </div>
        ) : matchesByStage.size === 0 ? (
          <div className="text-xs text-zinc-500">Väntar på nästa runda…</div>
        ) : (
          stageOrder.map((stage) => {
            const items = matchesByStage.get(stage) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={stage}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white"
                    style={{ backgroundColor: koStageBadgeColor(stage) }}
                  >
                    {KO_STAGE_LABEL[stage] ?? stage}
                  </span>
                  <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                </div>
                <div className="grid gap-2 grid-cols-1">
                  {items.map(({ court, match }) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      team1={teamMap.get(match.team1_id)!}
                      team2={teamMap.get(match.team2_id)!}
                      playerMap={playerMap}
                      courtName={court.name}
                      stage={matchDisplayStageLabel(match)}
                      badgeClass={badgeClassForMatch(match, groupIndexMap)}
                      onSave={(s1, s2) => saveScore(match, s1, s2)}
                      busy={busy === match.id}
                      gamesPerMatch={gamesPerMatch}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Slide-in modal containing the payment list. Triggered by the Betalning
// button in the header so the main content can use the full viewport width.
function PaymentModal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end p-4 bg-zinc-950/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Betalning"
    >
      <div
        className="w-full max-w-md max-h-[90vh] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Betalning</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="h-8 w-8 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden>
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function QrCodeModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — silently no-op; the URL is visible on screen.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="QR-kod för mobilrapportering"
    >
      <div
        className="w-full max-w-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Rapportera via mobil</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="h-8 w-8 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden>
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300 text-center">
            Spelare skannar koden för att välja sitt lag och rapportera resultat.
          </p>
          <div className="rounded-lg bg-white p-3">
            <QRCode value={url} style={{ width: 220, height: 220 }} />
          </div>
          <div className="w-full flex items-center gap-2">
            <code className="flex-1 truncate text-xs px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-200">
              {url}
            </code>
            <button
              type="button"
              onClick={copyUrl}
              className="shrink-0 px-3 py-2 rounded-md text-xs font-medium border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {copied ? "Kopierad" : "Kopiera"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionSettingsModal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end p-4 bg-zinc-950/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Inställningar"
    >
      <div
        className="w-full max-w-md max-h-[90vh] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Inställningar</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="h-8 w-8 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden>
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function SessionSettingsPanel({
  tournament,
  courts,
  matches,
  accent,
  onSaved,
}: {
  tournament: Tournament;
  courts: Court[];
  matches: TournamentMatch[];
  accent: string;
  onSaved: () => void | Promise<void>;
}) {
  // Courts currently in use by remaining (scheduled) group matches.
  const courtsInUseForScheduled = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matches) {
      if (m.stage !== "group") continue;
      if (m.status !== "scheduled") continue;
      if (m.court_id) ids.add(m.court_id);
    }
    return ids;
  }, [matches]);

  const scheduledGroupCount = useMemo(
    () =>
      matches.filter((m) => m.stage === "group" && m.status === "scheduled")
        .length,
    [matches]
  );

  const [games, setGames] = useState<number>(tournament.games_per_match);
  const [selectedCourts, setSelectedCourts] = useState<Set<string>>(() => {
    if (courtsInUseForScheduled.size > 0) {
      return new Set(courtsInUseForScheduled);
    }
    return new Set(courts.map((c) => c.id));
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initialCourtIds = useMemo(() => {
    const arr = [...courtsInUseForScheduled];
    arr.sort();
    return arr.join(",");
  }, [courtsInUseForScheduled]);
  const currentCourtIds = useMemo(() => {
    const arr = [...selectedCourts];
    arr.sort();
    return arr.join(",");
  }, [selectedCourts]);
  const courtsDirty = initialCourtIds !== currentCourtIds;
  const gamesDirty = games !== tournament.games_per_match;
  const gamesValid = Number.isInteger(games) && games >= 1 && games <= 99;
  const courtsValid = selectedCourts.size >= 1;
  const canSave =
    (gamesDirty || courtsDirty) && gamesValid && courtsValid && !saving;

  function toggleCourt(id: string) {
    setSelectedCourts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setErr(null);
    setSaving(true);
    try {
      if (gamesDirty && gamesValid) {
        await updateGamesPerMatch(tournament.id, games);
      }
      if (courtsDirty && courtsValid) {
        await reassignScheduledGroupCourts(tournament.id, [...selectedCourts]);
      }
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label
          htmlFor="settings-games-per-match"
          className="text-sm font-semibold text-zinc-800 dark:text-zinc-100"
        >
          Mål per match
        </label>
        <p className="text-xs text-zinc-500">
          Antal game vinnaren behöver. Påverkar bara matcher som inte är
          inrapporterade ännu.
        </p>
        <input
          id="settings-games-per-match"
          type="number"
          min={1}
          max={99}
          value={Number.isFinite(games) ? games : ""}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            setGames(Number.isFinite(v) ? v : 0);
          }}
          className="w-24 px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm tabular-nums"
        />
        {!gamesValid && (
          <p className="text-xs text-red-600">Måste vara mellan 1 och 99.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Banor för kommande matcher
          </h3>
          <p className="text-xs text-zinc-500">
            Avmarkera en bana om den inte längre kan användas. Kvarvarande
            gruppspelsmatcher (
            <span className="tabular-nums">{scheduledGroupCount}</span>) fördelas
            om jämnt över de valda banorna. Spelade matcher rörs inte.
          </p>
        </div>
        {courts.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">
            Inga banor är registrerade för anläggningen.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {courts.map((c) => {
              const checked = selectedCourts.has(c.id);
              return (
                <li key={c.id}>
                  <label className="flex items-center gap-3 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCourt(c.id)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="font-medium">{c.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {!courtsValid && (
          <p className="text-xs text-red-600">
            Minst en bana måste vara vald.
          </p>
        )}
      </section>

      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="px-4 py-2 rounded-md text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: accent }}
        >
          {saving ? "Sparar…" : "Spara"}
        </button>
      </div>
    </div>
  );
}
