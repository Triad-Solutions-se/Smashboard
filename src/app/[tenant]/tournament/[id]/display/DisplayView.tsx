"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { supabaseClient } from "@/lib/supabase/client";
import type {
  Tenant,
  Tournament,
  TournamentFormat,
  TournamentMatch,
  TournamentTeam,
  TournamentGroup,
  Court,
  Player,
} from "@/lib/supabase/types";
import {
  computeStandings,
  stageLabel,
  shortName,
  shortTeamName,
} from "@/lib/standings";
import type { RoundRest } from "@/lib/supabase/types";
import {
  buildGroupIndex,
  groupBadgeOrNull,
  groupPaletteFor,
} from "@/lib/group-colors";

type Loaded = {
  tournament: Tournament;
  groups: TournamentGroup[];
  matches: TournamentMatch[];
  teams: TournamentTeam[];
  players: Player[];
  courts: Court[];
  rests: RoundRest[];
};

const POLL_MS = 15_000;

const FORMAT_LABEL: Record<TournamentFormat, string> = {
  gruppspel: "Gruppspel",
  mexicano: "Mexicano",
  americano: "Americano",
  team_mexicano: "Lag-Mexicano",
};

export function DisplayView({
  tenant,
  tournamentId,
}: {
  tenant: Tenant;
  tournamentId: string;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const load = useCallback(async () => {
    const [tRes, gRes, mRes, teamsRes, courtsRes] = await Promise.all([
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
        .from("tournament_matches")
        .select("*")
        .eq("tournament_id", tournamentId),
      supabaseClient
        .from("tournament_teams")
        .select("*")
        .eq("tournament_id", tournamentId),
      supabaseClient
        .from("courts")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("sort_order"),
    ]);
    if (
      tRes.error ||
      gRes.error ||
      mRes.error ||
      teamsRes.error ||
      courtsRes.error
    )
      return;
    const teams = (teamsRes.data ?? []) as TournamentTeam[];
    const playerIds = Array.from(
      new Set(
        teams.flatMap((t) =>
          t.player2_id ? [t.player1_id, t.player2_id] : [t.player1_id]
        )
      )
    );
    const playersRes = playerIds.length
      ? await supabaseClient.from("players").select("*").in("id", playerIds)
      : { data: [], error: null };
    if (playersRes.error) return;
    const restsRes = await supabaseClient
      .from("round_rests")
      .select("*")
      .eq("tournament_id", tournamentId);

    setData({
      tournament: tRes.data as Tournament,
      groups: (gRes.data ?? []) as TournamentGroup[],
      matches: (mRes.data ?? []) as TournamentMatch[],
      teams,
      players: (playersRes.data ?? []) as Player[],
      courts: (courtsRes.data ?? []) as Court[],
      rests: (restsRes.data ?? []) as RoundRest[],
    });
  }, [tenant.id, tournamentId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Realtime subscriptions for instant updates (poll remains as fallback).
  useEffect(() => {
    const channel = supabaseClient
      .channel(`display:${tournamentId}`)
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_teams",
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => load()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournaments",
          filter: `id=eq.${tournamentId}`,
        },
        () => load()
      )
      .subscribe();

    // Reload on tab-visible so TV/laptop waking from sleep catches up instantly.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabaseClient.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tournamentId, load]);

  // Live clock — minute precision is enough.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const computed = useMemo(() => {
    if (!data) return null;
    const playerMap = new Map<string, Player>();
    for (const p of data.players) playerMap.set(p.id, p);
    const teamMap = new Map<string, TournamentTeam>();
    for (const t of data.teams) teamMap.set(t.id, t);
    const groupMap = new Map<string, TournamentGroup>();
    for (const g of data.groups) groupMap.set(g.id, g);
    const groupIndexMap = buildGroupIndex(data.groups);

    const byCourt = new Map<string, TournamentMatch>();
    const nextByCourt = new Map<string, TournamentMatch>();
    for (const c of data.courts) {
      const queued = data.matches
        .filter((m) => m.court_id === c.id && m.status !== "completed")
        .sort(
          (a, b) =>
            a.round_number - b.round_number ||
            a.created_at.localeCompare(b.created_at)
        );
      if (queued[0]) byCourt.set(c.id, queued[0]);
      if (queued[1]) nextByCourt.set(c.id, queued[1]);
    }

    // For each court's current match, find teams that still have an incomplete
    // earlier-round match (they haven't finished yet → court is "waiting").
    const lockedByCourt = new Map<string, TournamentTeam[]>();
    for (const [courtId, match] of byCourt) {
      const blocking: TournamentTeam[] = [];
      for (const teamId of [match.team1_id, match.team2_id]) {
        const stillBusy = data.matches.some(
          (m) =>
            m.round_number < match.round_number &&
            m.status !== "completed" &&
            (m.team1_id === teamId || m.team2_id === teamId)
        );
        if (stillBusy) {
          const t = teamMap.get(teamId);
          if (t) blocking.push(t);
        }
      }
      if (blocking.length > 0) lockedByCourt.set(courtId, blocking);
    }

    const completed = data.matches.filter((m) => m.status === "completed").length;
    const total = data.matches.length;
    const hasGroups = data.groups.length > 0;

    const koMatches = data.matches.filter((m) => m.stage !== "group");
    const groupMatches = data.matches.filter((m) => m.stage === "group");
    const hasKO = koMatches.length > 0;

    // Only courts that this tournament actually uses, sorted by group
    const tournamentCourts = (() => {
      const used = data.courts.filter((c) =>
        data.matches.some((m) => m.court_id === c.id)
      );
      return used.sort((a, b) => {
        const ma = data.matches.find((m) => m.court_id === a.id);
        const mb = data.matches.find((m) => m.court_id === b.id);
        const ga = ma?.group_id ? groupIndexMap.get(ma.group_id) ?? 9999 : 9999;
        const gb = mb?.group_id ? groupIndexMap.get(mb.group_id) ?? 9999 : 9999;
        if (ga !== gb) return ga - gb;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
    })();

    // Current group round for resting teams
    const currentGroupRound = (() => {
      const incomplete = groupMatches.filter((m) => m.status !== "completed");
      if (incomplete.length === 0) return null;
      return Math.min(...incomplete.map((m) => m.round_number));
    })();

    const restingTeamIds: string[] = currentGroupRound
      ? data.rests.filter((r) => r.round_number === currentGroupRound).map((r) => r.team_id)
      : [];

    // Active KO stage (the incomplete non-bronze stage)
    const activeKOMatches = koMatches.filter(
      (m) => m.status !== "completed" && m.stage !== "bronze"
    );
    const activeKOStage = activeKOMatches.length > 0 ? activeKOMatches[0].stage : null;

    // Tournament fully done: a final exists and every match is completed
    const finalMatches = koMatches.filter((m) => m.stage === "final");
    const tournamentDone =
      data.matches.length > 0 &&
      data.matches.every((m) => m.status === "completed") &&
      finalMatches.length > 0;

    let finalRanking: { teamId: string; place: number }[] = [];
    if (tournamentDone) {
      const winnerOf = new Map<string, string>();
      const loserOf = new Map<string, string>();
      for (const m of koMatches) {
        if (m.status !== "completed") continue;
        const t1Win = (m.score_team1 ?? 0) > (m.score_team2 ?? 0);
        winnerOf.set(m.id, t1Win ? m.team1_id : m.team2_id);
        loserOf.set(m.id, t1Win ? m.team2_id : m.team1_id);
      }

      const placed: { teamId: string; place: number }[] = [];
      const placedIds = new Set<string>();

      const finalMatch = finalMatches[0];
      const finalWinner = winnerOf.get(finalMatch.id);
      const finalLoser = loserOf.get(finalMatch.id);
      if (finalWinner) {
        placed.push({ teamId: finalWinner, place: 1 });
        placedIds.add(finalWinner);
      }
      if (finalLoser) {
        placed.push({ teamId: finalLoser, place: 2 });
        placedIds.add(finalLoser);
      }

      const bronzeMatch = koMatches.find(
        (m) => m.stage === "bronze" && m.status === "completed"
      );
      if (bronzeMatch) {
        const bw = winnerOf.get(bronzeMatch.id);
        const bl = loserOf.get(bronzeMatch.id);
        if (bw && !placedIds.has(bw)) {
          placed.push({ teamId: bw, place: 3 });
          placedIds.add(bw);
        }
        if (bl && !placedIds.has(bl)) {
          placed.push({ teamId: bl, place: 4 });
          placedIds.add(bl);
        }
      }

      // Remaining teams: sort by overall stats (group + KO)
      const allCompleted = data.matches.filter((m) => m.status === "completed");
      const overall = computeStandings(data.teams, allCompleted, playerMap);
      let nextPlace = placed.length + 1;
      for (const s of overall) {
        if (placedIds.has(s.team_id)) continue;
        placed.push({ teamId: s.team_id, place: nextPlace++ });
        placedIds.add(s.team_id);
      }

      finalRanking = placed;
    }

    return {
      playerMap,
      teamMap,
      groupMap,
      groupIndexMap,
      byCourt,
      nextByCourt,
      lockedByCourt,
      completed,
      total,
      hasGroups,
      koMatches,
      hasKO,
      activeKOStage,
      restingTeamIds,
      tournamentDone,
      finalRanking,
      tournamentCourts,
    };
  }, [data]);

  const accent = tenant.primary_color || "#10b981";

  if (!data || !computed) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center">
        <div className="flex items-center gap-4">
          <span
            className="inline-block w-3 h-3 rounded-full animate-pulse"
            style={{ backgroundColor: accent }}
          />
          <span style={{ fontSize: "clamp(1.5rem, 3vw, 3rem)" }}>
            Laddar...
          </span>
        </div>
      </div>
    );
  }

  const timeLabel = now.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="h-screen w-screen bg-zinc-50 text-zinc-900 overflow-hidden flex flex-col"
      style={
        {
          "--accent": accent,
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%)",
        } as React.CSSProperties
      }
    >
      <Header
        tenant={tenant}
        tournament={data.tournament}
        accent={accent}
        timeLabel={timeLabel}
        completed={computed.completed}
        total={computed.total}
      />

      <main className="flex-1 min-h-0 px-[1.5vw] py-[1vh] flex gap-[1vw]">
        {computed.tournamentDone ? (
          <PodiumView
            ranking={computed.finalRanking}
            teamMap={computed.teamMap}
            playerMap={computed.playerMap}
            accent={accent}
          />
        ) : computed.hasKO ? (
          <KOView
            koMatches={computed.koMatches}
            activeKOStage={computed.activeKOStage}
            courts={computed.tournamentCourts}
            byCourt={computed.byCourt}
            nextByCourt={computed.nextByCourt}
            lockedByCourt={computed.lockedByCourt}
            teamMap={computed.teamMap}
            groupMap={computed.groupMap}
            groupIndexMap={computed.groupIndexMap}
            playerMap={computed.playerMap}
            accent={accent}
          />
        ) : (
          <>
            <div className="flex-1 min-w-0 flex flex-col gap-[1.5vh]">
              {computed.restingTeamIds.length > 0 && (
                <RestingChip
                  teamIds={computed.restingTeamIds}
                  teamMap={computed.teamMap}
                  playerMap={computed.playerMap}
                  accent={accent}
                />
              )}
              <div className="flex-1 min-h-0">
                <MatchesView
                  courts={computed.tournamentCourts}
                  byCourt={computed.byCourt}
                  nextByCourt={computed.nextByCourt}
                  lockedByCourt={computed.lockedByCourt}
                  teamMap={computed.teamMap}
                  groupMap={computed.groupMap}
                  groupIndexMap={computed.groupIndexMap}
                  playerMap={computed.playerMap}
                  accent={accent}
                />
              </div>
            </div>
            {computed.hasGroups && (
              <aside className="w-[17vw] max-w-[320px] min-w-[180px] shrink-0">
                <StandingsColumn
                  groups={data.groups}
                  teams={data.teams}
                  matches={data.matches}
                  playerMap={computed.playerMap}
                  accent={accent}
                />
              </aside>
            )}
          </>
        )}
      </main>

      <Footer
        tournament={data.tournament}
        tenant={tenant}
        timeLabel={timeLabel}
        hasKO={computed.hasKO}
        tournamentDone={computed.tournamentDone}
      />

      <FullscreenButton accent={accent} />
    </div>
  );
}

// --- Resting cards (group phase) ---
function RestingChip({
  teamIds,
  teamMap,
  playerMap,
  accent,
}: {
  teamIds: string[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-[1vw]">
      <span
        className="shrink-0 font-bold uppercase tracking-wider"
        style={{ fontSize: "clamp(0.55rem, 0.75vw, 0.9rem)", color: accent }}
      >
        Vilar
      </span>
      <div className="flex flex-wrap gap-[0.6vw]">
        {teamIds.map((tid) => {
          const t = teamMap.get(tid);
          if (!t) return null;
          const p1 = playerMap.get(t.player1_id);
          const p2 = t.player2_id ? playerMap.get(t.player2_id) : null;
          return (
            <div
              key={tid}
              className="rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${accent}18 0%, ${accent}08 100%)`,
                border: `1.5px solid ${accent}33`,
                padding: "clamp(0.25rem, 0.4vh, 0.5rem) clamp(0.5rem, 0.8vw, 1rem)",
              }}
            >
              <span
                className="font-semibold text-zinc-700"
                style={{ fontSize: "clamp(0.65rem, 0.9vw, 1.1rem)" }}
              >
                {shortName(p1)}{p2 ? ` & ${shortName(p2)}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- KO Bracket View ---

const KO_STAGE_LABELS: Record<string, string> = {
  quarter_final: "Kvartsfinal",
  semi_final: "Semifinal",
  final: "Final",
  bronze: "Bronsmatch",
};

const KO_STAGE_ORDER = ["quarter_final", "semi_final", "final", "bronze"] as const;

function koStageColor(stage: string, accent: string): string {
  switch (stage) {
    case "final": return "#d97706";
    case "semi_final": return "#7c3aed";
    case "bronze": return "#b45309";
    default: return accent;
  }
}

function KOView({
  koMatches,
  activeKOStage,
  courts,
  byCourt,
  nextByCourt,
  lockedByCourt,
  teamMap,
  groupMap,
  groupIndexMap,
  playerMap,
  accent,
}: {
  koMatches: TournamentMatch[];
  activeKOStage: string | null;
  courts: Court[];
  byCourt: Map<string, TournamentMatch>;
  nextByCourt: Map<string, TournamentMatch>;
  lockedByCourt: Map<string, TournamentTeam[]>;
  teamMap: Map<string, TournamentTeam>;
  groupMap: Map<string, TournamentGroup>;
  groupIndexMap: Map<string, number>;
  playerMap: Map<string, Player>;
  accent: string;
}) {
  const koCourts = useMemo(
    () => courts.filter((c) => koMatches.some((m) => m.court_id === c.id && m.status !== "completed")),
    [courts, koMatches]
  );

  const displayCourts = koCourts.length > 0 ? koCourts : courts;

  // Group active courts by their current match's stage for simultaneous QF+SF display.
  const stageGroups = useMemo(() => {
    return KO_STAGE_ORDER
      .map((stage) => ({
        stage,
        courts: displayCourts.filter((c) => byCourt.get(c.id)?.stage === stage),
        color: koStageColor(stage, accent),
      }))
      .filter((g) => g.courts.length > 0);
  }, [displayCourts, byCourt, accent]);

  const hasMultipleStages = stageGroups.length > 1;

  // All active stages for the header label
  const activeStages = useMemo(
    () => [...new Set(koMatches.filter((m) => m.status !== "completed" && m.stage !== "bronze").map((m) => m.stage))],
    [koMatches]
  );
  const activeBronze = koMatches.some((m) => m.stage === "bronze" && m.status !== "completed");

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-[1vh]">
      {/* Stage header row */}
      <div className="flex items-center gap-[1vw] flex-wrap">
        <span
          className="font-bold uppercase tracking-widest text-zinc-400"
          style={{ fontSize: "clamp(0.6rem, 0.85vw, 1rem)" }}
        >
          Slutspel
        </span>
        {activeStages.map((stage) => (
          <span
            key={stage}
            className="font-black uppercase tracking-widest px-[1vw] py-[0.35vh] rounded-full text-white"
            style={{ backgroundColor: koStageColor(stage, accent), fontSize: "clamp(0.7rem, 1.1vw, 1.4rem)" }}
          >
            {KO_STAGE_LABELS[stage] ?? stage}
          </span>
        ))}
        {activeBronze && (
          <span
            className="font-black uppercase tracking-widest px-[1vw] py-[0.35vh] rounded-full text-white"
            style={{ backgroundColor: "#b45309", fontSize: "clamp(0.7rem, 1.1vw, 1.4rem)" }}
          >
            Bronsmatch
          </span>
        )}
      </div>

      {/* Courts — split into labeled sections when multiple stages run simultaneously */}
      <div className={`flex-1 min-h-0 ${hasMultipleStages ? "flex gap-[2vw]" : ""}`}>
        {hasMultipleStages ? (
          stageGroups.map(({ stage, courts: stageCourts, color }) => (
            <div key={stage} className="flex-1 min-h-0 flex flex-col gap-[0.6vh]">
              <div className="flex items-center gap-[0.6vw]">
                <div className="h-[2px] w-[1vw] rounded" style={{ backgroundColor: color }} />
                <span
                  className="font-black uppercase tracking-widest text-white px-[0.8vw] py-[0.25vh] rounded-full"
                  style={{ backgroundColor: color, fontSize: "clamp(0.55rem, 0.85vw, 1rem)" }}
                >
                  {KO_STAGE_LABELS[stage] ?? stage}
                </span>
                <div className="h-[2px] flex-1 rounded" style={{ backgroundColor: color }} />
              </div>
              <div className="flex-1 min-h-0">
                <MatchesView
                  courts={stageCourts}
                  byCourt={byCourt}
                  nextByCourt={nextByCourt}
                  lockedByCourt={lockedByCourt}
                  teamMap={teamMap}
                  groupMap={groupMap}
                  groupIndexMap={groupIndexMap}
                  playerMap={playerMap}
                  accent={accent}
                />
              </div>
            </div>
          ))
        ) : (
          <MatchesView
            courts={displayCourts}
            byCourt={byCourt}
            nextByCourt={nextByCourt}
            lockedByCourt={lockedByCourt}
            teamMap={teamMap}
            groupMap={groupMap}
            groupIndexMap={groupIndexMap}
            playerMap={playerMap}
            accent={accent}
          />
        )}
      </div>
    </div>
  );
}

function Header({
  tenant,
  tournament,
  accent,
  timeLabel,
  completed,
  total,
}: {
  tenant: Tenant;
  tournament: Tournament;
  accent: string;
  timeLabel: string;
  completed: number;
  total: number;
}) {
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  useEffect(() => {
    setPlayUrl(`${window.location.origin}/${tenant.slug}/tournament/${tournament.id}/play`);
  }, [tenant.slug, tournament.id]);

  return (
    <header className="px-[2vw] pt-[1.2vh] pb-[1vh] grid grid-cols-3 items-center gap-4 border-b border-zinc-200">
      {/* Left: tournament info */}
      <div className="min-w-0">
        <div
          className="font-black tracking-tight leading-none truncate text-zinc-900"
          style={{ fontSize: "clamp(1.2rem, 2.2vw, 2.5rem)" }}
        >
          {tournament.name}
        </div>
        <div
          className="mt-1 flex items-center gap-2 truncate"
          style={{ fontSize: "clamp(0.7rem, 0.9vw, 1rem)" }}
        >
          <span className="font-semibold text-zinc-700">{tenant.name}</span>
          <span
            className="inline-block w-px bg-zinc-300"
            style={{ height: "0.9em" }}
            aria-hidden="true"
          />
          <span className="text-zinc-600">
            {FORMAT_LABEL[tournament.format]}
          </span>
          <span
            className="inline-block w-px bg-zinc-300"
            style={{ height: "0.9em" }}
            aria-hidden="true"
          />
          <span className="text-zinc-500 tabular-nums">
            Mål {tournament.games_per_match} game
          </span>
        </div>
      </div>

      {/* Center: brand logo × Triad Solutions logo */}
      <div className="flex items-center justify-center gap-[1.2vw]">
        {tenant.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tenant.logo_url}
            alt={tenant.name}
            className="h-[4.5vh] w-auto object-contain"
          />
        ) : (
          <div
            className="h-[4.5vh] aspect-square rounded-lg flex items-center justify-center font-black"
            style={{
              backgroundColor: `${accent}20`,
              color: accent,
              fontSize: "clamp(1.1rem, 1.8vw, 1.8rem)",
            }}
          >
            {tenant.name.charAt(0)}
          </div>
        )}
        <span
          className="font-black text-zinc-300 leading-none select-none"
          style={{ fontSize: "clamp(1.2rem, 2vw, 2.2rem)" }}
        >
          ×
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/triad-logo.png"
          alt="Triad Solutions"
          className="h-[4.5vh] w-auto object-contain"
        />
      </div>

      {/* Right: QR code + live indicator */}
      <div className="flex items-center justify-end gap-[1.5vw] shrink-0">
        {playUrl && (
          <div className="flex items-center gap-[0.6vw]">
            <div style={{ fontSize: "clamp(0.5rem, 0.7vw, 0.88rem)" }} className="text-zinc-400 leading-tight text-right">
              <p className="font-semibold text-zinc-500">Rapportera</p>
              <p>Skanna &amp; välj ditt lag</p>
            </div>
            <div className="bg-white rounded-lg p-[3px]" style={{ width: "clamp(56px, 6.5vw, 88px)", height: "clamp(56px, 6.5vw, 88px)" }}>
              <QRCode value={playUrl} style={{ width: "100%", height: "100%" }} />
            </div>
          </div>
        )}
        <div className="hidden sm:flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: accent }}
            />
            <span
              className="uppercase tracking-widest font-semibold text-zinc-700"
              style={{ fontSize: "clamp(0.55rem, 0.7vw, 0.85rem)" }}
            >
              Live · {timeLabel}
            </span>
          </div>
          <div
            className="text-zinc-500 tabular-nums"
            style={{ fontSize: "clamp(0.55rem, 0.7vw, 0.85rem)" }}
          >
            {completed} / {total} matcher
          </div>
        </div>
      </div>
    </header>
  );
}

function getGridCols(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  // 4+ courts: target 3 rows
  return Math.ceil(n / 3);
}

function MatchesView({
  courts,
  byCourt,
  nextByCourt,
  lockedByCourt,
  teamMap,
  groupMap,
  groupIndexMap,
  playerMap,
  accent,
}: {
  courts: Court[];
  byCourt: Map<string, TournamentMatch>;
  nextByCourt: Map<string, TournamentMatch>;
  lockedByCourt: Map<string, TournamentTeam[]>;
  teamMap: Map<string, TournamentTeam>;
  groupMap: Map<string, TournamentGroup>;
  groupIndexMap: Map<string, number>;
  playerMap: Map<string, Player>;
  accent: string;
}) {
  if (courts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <span style={{ fontSize: "clamp(1.5rem, 3vw, 3rem)" }}>
          Inga banor konfigurerade
        </span>
      </div>
    );
  }
  const cols = getGridCols(courts.length);
  return (
    <div
      className="h-full grid gap-[1vw]"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: "1fr",
      }}
    >
      {courts.map((court) => (
        <CourtCard
          key={court.id}
          court={court}
          match={byCourt.get(court.id) ?? null}
          nextMatch={nextByCourt.get(court.id) ?? null}
          blockingTeams={lockedByCourt.get(court.id) ?? null}
          teamMap={teamMap}
          groupMap={groupMap}
          groupIndexMap={groupIndexMap}
          playerMap={playerMap}
          accent={accent}
        />
      ))}
    </div>
  );
}

function CourtCard({
  court,
  match,
  nextMatch,
  blockingTeams,
  teamMap,
  groupMap,
  groupIndexMap,
  playerMap,
  accent,
}: {
  court: Court;
  match: TournamentMatch | null;
  nextMatch: TournamentMatch | null;
  blockingTeams: TournamentTeam[] | null;
  teamMap: Map<string, TournamentTeam>;
  groupMap: Map<string, TournamentGroup>;
  groupIndexMap: Map<string, number>;
  playerMap: Map<string, Player>;
  accent: string;
}) {
  const t1 = match ? teamMap.get(match.team1_id) ?? null : null;
  const t2 = match ? teamMap.get(match.team2_id) ?? null : null;
  const stage = match ? stageLabel(match, groupMap) : null;
  const live = match?.status === "in_progress";
  const isFinal = match?.stage === "final";
  const idle = !match;
  const locked = !!blockingTeams?.length;
  const groupBadge = match ? groupBadgeOrNull(match, groupIndexMap) : null;

  return (
    <div
      className={`relative overflow-hidden flex flex-col rounded-2xl transition-opacity ${idle ? "opacity-40 saturate-50" : ""}`}
      style={{
        containerType: "inline-size",
        ...(live
          ? { boxShadow: `inset 0 0 0 2px ${accent}, 0 0 28px -10px ${accent}` }
          : {}),
      }}
    >
      {/* top bar */}
      <div className="relative px-[1vw] pt-[0.7vh] pb-[0.4vh] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="rounded px-1.5 py-0.5 font-black tracking-tight"
            style={{
              backgroundColor: `${accent}1f`,
              color: accent,
              fontSize: "clamp(0.65rem, 3cqi, 2rem)",
            }}
          >
            {court.name}
          </div>
          {live && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-black uppercase tracking-widest text-white"
              style={{
                backgroundColor: accent,
                fontSize: "clamp(0.5rem, 0.7vw, 0.85rem)",
                boxShadow: `0 0 0 3px ${accent}22`,
              }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
          {idle && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 font-bold uppercase tracking-widest bg-zinc-200 text-zinc-500"
              style={{ fontSize: "clamp(0.45rem, 0.6vw, 0.75rem)" }}
            >
              Klar
            </span>
          )}
          {locked && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 font-bold uppercase tracking-widest bg-amber-100 text-amber-700"
              style={{ fontSize: "clamp(0.45rem, 0.6vw, 0.75rem)" }}
            >
              Nästa
            </span>
          )}
        </div>
        {stage && (
          groupBadge ? (
            <div
              className={`font-bold uppercase tracking-wider px-2 py-0.5 rounded ${groupBadge}`}
              style={{ fontSize: "clamp(0.55rem, 2.5cqi, 1.6rem)" }}
            >
              {stage}
            </div>
          ) : (
            // KO stage — colored pill so it's always obvious
            <div
              className="font-black uppercase tracking-wider px-[0.5em] py-[0.15em] rounded-full text-white"
              style={{
                fontSize: "clamp(0.5rem, 2.2cqi, 1.4rem)",
                backgroundColor: match?.stage === "final"
                  ? "#d97706"
                  : match?.stage === "semi_final"
                    ? "#7c3aed"
                    : match?.stage === "bronze"
                      ? "#b45309"
                      : accent,
              }}
            >
              {stage}
            </div>
          )
        )}
      </div>

      {/* matchup — court SVG sits behind only this section so it never touches header/footer text */}
      <div className={`relative flex-1 min-h-0 px-[0.4vw] pb-[0.4vh] flex items-center transition-opacity ${locked ? "opacity-40" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/court-topdown.svg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-contain object-center pointer-events-none"
        />
        {match && t1 && t2 ? (
          <div className="relative w-full grid grid-cols-2 items-center gap-[1vw] px-[10%]">
            <TeamBlock team={t1} playerMap={playerMap} align="right" />
            <TeamBlock team={t2} playerMap={playerMap} align="left" />
          </div>
        ) : (
          <div className="relative w-full">
            <DoneState />
          </div>
        )}
      </div>

      {/* footer — always rendered so all courts stay the same height */}
      {match && blockingTeams && blockingTeams.length > 0 ? (
        <WaitingFor blockingTeams={blockingTeams} playerMap={playerMap} />
      ) : match && nextMatch ? (
        <NextUp
          match={nextMatch}
          teamMap={teamMap}
          playerMap={playerMap}
          accent={accent}
        />
      ) : (
        <div
          className="border-t border-transparent"
          style={{ padding: "0.5vh 0" }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function TeamBlock({
  team,
  playerMap,
  align,
}: {
  team: TournamentTeam;
  playerMap: Map<string, Player>;
  align: "left" | "right";
}) {
  const p1 = playerMap.get(team.player1_id);
  const p2 = team.player2_id ? playerMap.get(team.player2_id) : undefined;
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <div
        className="font-bold leading-tight text-white"
        style={{
          fontSize: "clamp(0.7rem, 7cqi, 3rem)",
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          wordBreak: "break-word",
        }}
      >
        {shortName(p1)}
      </div>
      <div
        className="font-bold leading-tight text-white"
        style={{
          fontSize: "clamp(0.7rem, 7cqi, 3rem)",
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          wordBreak: "break-word",
        }}
      >
        {shortName(p2)}
      </div>
    </div>
  );
}

function PodiumView({
  ranking,
  teamMap,
  playerMap,
  accent,
}: {
  ranking: { teamId: string; place: number }[];
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  accent: string;
}) {
  const top3 = [1, 2, 3].map((p) => ranking.find((r) => r.place === p) ?? null);
  const rest = ranking.filter((r) => r.place > 3);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-[2vh]">
      <div className="flex items-end justify-center gap-[1.5vw] px-[4vw]" style={{ height: "55%" }}>
        <PodiumPillar
          place={2}
          entry={top3[1]}
          teamMap={teamMap}
          playerMap={playerMap}
          color="#94a3b8"
          heightPct={70}
        />
        <PodiumPillar
          place={1}
          entry={top3[0]}
          teamMap={teamMap}
          playerMap={playerMap}
          color={accent}
          heightPct={100}
          gold
        />
        <PodiumPillar
          place={3}
          entry={top3[2]}
          teamMap={teamMap}
          playerMap={playerMap}
          color="#b45309"
          heightPct={50}
        />
      </div>
      {rest.length > 0 && (
        <div className="flex-1 min-h-0 overflow-hidden px-[2vw]">
          <div
            className="grid gap-x-[3vw] gap-y-[0.6vh] content-start"
            style={{
              gridTemplateColumns: `repeat(${rest.length > 8 ? 3 : 2}, minmax(0, 1fr))`,
            }}
          >
            {rest.map((r) => {
              const t = teamMap.get(r.teamId);
              const p1 = t ? playerMap.get(t.player1_id) : null;
              const p2 = t && t.player2_id ? playerMap.get(t.player2_id) : null;
              return (
                <div
                  key={r.teamId}
                  className="flex items-baseline gap-[1vw] border-b border-zinc-200 pb-[0.4vh]"
                >
                  <span
                    className="font-bold tabular-nums text-zinc-400 shrink-0 w-[3ch] text-right"
                    style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.5rem)" }}
                  >
                    {r.place}.
                  </span>
                  <span
                    className="font-medium text-zinc-800 truncate"
                    style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.5rem)" }}
                  >
                    {p1 ? shortName(p1) : "?"}{p2 ? ` & ${shortName(p2)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PodiumPillar({
  place,
  entry,
  teamMap,
  playerMap,
  color,
  heightPct,
  gold,
}: {
  place: number;
  entry: { teamId: string; place: number } | null;
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  color: string;
  heightPct: number;
  gold?: boolean;
}) {
  const t = entry ? teamMap.get(entry.teamId) : null;
  const p1 = t ? playerMap.get(t.player1_id) : null;
  const p2 = t && t.player2_id ? playerMap.get(t.player2_id) : null;
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-[1vh]">
      <div className="text-center min-w-0 w-full px-[0.5vw]">
        <div
          className="font-bold leading-tight truncate"
          style={{
            fontSize: gold ? "clamp(1rem, 2.2vw, 3rem)" : "clamp(0.85rem, 1.6vw, 2.2rem)",
            color: gold ? color : "#1f2937",
          }}
        >
          {p1 ? shortName(p1) : "—"}
        </div>
        {p2 && (
          <div
            className="font-bold leading-tight truncate"
            style={{
              fontSize: gold ? "clamp(1rem, 2.2vw, 3rem)" : "clamp(0.85rem, 1.6vw, 2.2rem)",
              color: gold ? color : "#1f2937",
            }}
          >
            {shortName(p2)}
          </div>
        )}
      </div>
      <div
        className="w-full rounded-t-2xl flex items-start justify-center pt-[1.5vh]"
        style={{
          height: `${heightPct}%`,
          background: `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)`,
          boxShadow: gold ? `0 0 40px -8px ${color}` : undefined,
        }}
      >
        <div
          className="font-black text-white"
          style={{ fontSize: gold ? "clamp(2rem, 6vw, 8rem)" : "clamp(1.5rem, 4.5vw, 6rem)" }}
        >
          {place}
        </div>
      </div>
    </div>
  );
}

function DoneState() {
  return (
    <div className="w-full flex flex-col items-center justify-center text-zinc-400 gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-trophy.svg"
        alt=""
        aria-hidden="true"
        className="opacity-80"
        style={{ width: "clamp(2rem, 4vw, 4.5rem)", height: "auto" }}
      />
      <div
        className="font-black tracking-tight"
        style={{ fontSize: "clamp(1rem, 2vw, 2.4rem)" }}
      >
        Klar
      </div>
    </div>
  );
}

function WaitingFor({
  blockingTeams,
  playerMap,
}: {
  blockingTeams: TournamentTeam[];
  playerMap: Map<string, Player>;
}) {
  const names = blockingTeams.map((t) => shortTeamName(t, playerMap)).join(" & ");
  return (
    <div className="relative border-t border-amber-200 px-[1vw] py-[0.5vh] flex items-center gap-2 bg-amber-50/60">
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-black uppercase tracking-widest shrink-0 bg-amber-100 text-amber-700"
        style={{ fontSize: "clamp(0.45rem, 0.6vw, 0.75rem)" }}
      >
        Väntar
      </span>
      <span
        className="truncate font-semibold text-amber-800"
        style={{ fontSize: "clamp(0.6rem, 0.8vw, 0.95rem)" }}
      >
        {names}
      </span>
    </div>
  );
}

function NextUp({
  match,
  teamMap,
  playerMap,
  accent,
}: {
  match: TournamentMatch;
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  accent: string;
}) {
  const t1 = teamMap.get(match.team1_id);
  const t2 = teamMap.get(match.team2_id);
  if (!t1 || !t2) return null;
  return (
    <div className="relative border-t border-zinc-200 px-[1vw] py-[0.5vh] flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-black uppercase tracking-widest shrink-0"
        style={{
          backgroundColor: `${accent}1a`,
          color: accent,
          fontSize: "clamp(0.45rem, 0.6vw, 0.75rem)",
        }}
      >
        Nästa
        <span aria-hidden="true">→</span>
      </span>
      <span
        className="truncate font-semibold text-zinc-700"
        style={{ fontSize: "clamp(0.6rem, 0.8vw, 0.95rem)" }}
      >
        {shortTeamName(t1, playerMap)}{" "}
        <span className="text-zinc-400 font-normal">vs</span>{" "}
        {shortTeamName(t2, playerMap)}
      </span>
    </div>
  );
}

function StandingsColumn({
  groups,
  teams,
  matches,
  playerMap,
  accent,
}: {
  groups: TournamentGroup[];
  teams: TournamentTeam[];
  matches: TournamentMatch[];
  playerMap: Map<string, Player>;
  accent: string;
}) {
  // Count total rows to auto-scale font size so everything fits
  const totalTeamRows = groups.reduce((sum, g) => {
    const gt = teams.filter((t) => t.group_id === g.id);
    const gm = matches.filter((m) => m.group_id === g.id);
    return sum + Math.max(computeStandings(gt, gm, playerMap).length, 1);
  }, 0);
  const totalRows = totalTeamRows + groups.length; // team rows + group headers
  // Scale: ≤20 rows → 1x, 21-30 → 0.88x, >30 → 0.76x
  const scale = totalRows <= 20 ? 1 : totalRows <= 30 ? 0.88 : 0.76;

  return (
    <div
      className="h-full rounded-2xl overflow-hidden flex flex-col border border-zinc-200 bg-white"
      style={{ boxShadow: "0 4px 18px -10px rgba(0,0,0,0.18)" }}
    >
      <div
        className="px-[0.8vw] py-[0.6vh] flex items-center justify-between border-b border-zinc-200 shrink-0"
        style={{ backgroundColor: `${accent}15` }}
      >
        <div
          className="font-black tracking-tight uppercase"
          style={{
            fontSize: "clamp(0.55rem, 0.75vw, 0.88rem)",
            color: accent,
            letterSpacing: "0.1em",
          }}
        >
          Tabell
        </div>
        <div
          className="text-zinc-500 uppercase tracking-widest font-semibold tabular-nums"
          style={{ fontSize: "clamp(0.45rem, 0.55vw, 0.7rem)" }}
        >
          # · LAG · GD
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col divide-y divide-zinc-200 overflow-y-auto">
        {groups.map((g, gi) => {
          const groupTeams = teams.filter((t) => t.group_id === g.id);
          const groupMatches = matches.filter((m) => m.group_id === g.id);
          const standings = computeStandings(groupTeams, groupMatches, playerMap);
          const teamById = new Map(groupTeams.map((t) => [t.id, t]));
          const palette = groupPaletteFor(gi);
          return (
            <div key={g.id} className="flex-1 min-h-fit flex flex-col">
              <div
                className={`px-[0.8vw] font-bold tracking-tight flex items-center justify-between ${palette.bar}`}
                style={{
                  fontSize: `clamp(0.5rem, ${0.72 * scale}vw, ${0.88 * scale}rem)`,
                  padding: `${0.22 * scale}vh 0.8vw`,
                }}
              >
                <span>{g.name}</span>
                <span className="opacity-60 tabular-nums font-semibold" style={{ fontSize: `clamp(0.45rem, ${0.58 * scale}vw, ${0.72 * scale}rem)` }}>
                  {standings.length}
                </span>
              </div>
              <ul className="flex flex-col">
                {standings.map((s, i) => {
                  const top = i === 0;
                  return (
                    <li
                      key={s.team_id}
                      className="px-[0.8vw] flex items-center gap-[0.4vw] border-t border-zinc-100"
                      style={{
                        fontSize: `clamp(0.5rem, ${0.7 * scale}vw, ${0.86 * scale}rem)`,
                        padding: `${0.18 * scale}vh 0.8vw`,
                      }}
                    >
                      <span
                        className="shrink-0 inline-flex items-center justify-center rounded-full w-[1.5em] h-[1.5em] font-black tabular-nums"
                        style={
                          top
                            ? { backgroundColor: `${accent}25`, color: accent }
                            : { color: "#a1a1aa" }
                        }
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 font-semibold truncate text-zinc-800">
                        {(() => {
                          const team = teamById.get(s.team_id);
                          return team
                            ? shortTeamName(team, playerMap)
                            : s.teamName;
                        })()}
                      </span>
                      <span
                        className="shrink-0 tabular-nums font-bold"
                        style={{
                          color:
                            s.gd > 0
                              ? accent
                              : s.gd < 0
                                ? "#dc2626"
                                : "#71717a",
                        }}
                      >
                        {s.gd > 0 ? `+${s.gd}` : s.gd}
                      </span>
                    </li>
                  );
                })}
                {standings.length === 0 && (
                  <li
                    className="px-[0.8vw] py-[0.5vh] flex items-center justify-center text-zinc-400"
                    style={{ fontSize: `clamp(0.5rem, ${0.7 * scale}vw, 0.88rem)` }}
                  >
                    Inga lag
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Footer({
  tournament,
  tenant,
  timeLabel,
  hasKO,
  tournamentDone,
}: {
  tournament: Tournament;
  tenant: Tenant;
  timeLabel: string;
  hasKO: boolean;
  tournamentDone: boolean;
}) {
  return (
    <footer className="px-[2vw] py-[0.7vh] border-t border-zinc-200 flex items-center justify-between gap-3">
      <div
        className="text-zinc-500 uppercase tracking-widest font-semibold flex items-center gap-2 min-w-0"
        style={{ fontSize: "clamp(0.5rem, 0.7vw, 0.85rem)" }}
      >
        <span className="text-zinc-700">{tenant.name}</span>
        <span className="text-zinc-300">·</span>
        <span>
          {tournamentDone || tournament.status === "completed"
            ? "Avslutad"
            : hasKO
              ? "Slutspel"
              : "Pågående"}
        </span>
        <span className="text-zinc-300">·</span>
        <span className="tabular-nums">Uppdaterad {timeLabel}</span>
      </div>
      <div
        className="text-zinc-400 uppercase tracking-widest font-semibold"
        style={{ fontSize: "clamp(0.5rem, 0.7vw, 0.85rem)" }}
      >
        smashboard
      </div>
    </footer>
  );
}

function FullscreenButton({ accent }: { accent: string }) {
  const [isFs, setIsFs] = useState<boolean>(false);

  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isFs ? "Avsluta helskärm" : "Helskärm"}
      title={isFs ? "Avsluta helskärm" : "Helskärm"}
      className="fixed top-3 right-3 z-50 inline-flex items-center justify-center rounded-full bg-white/90 backdrop-blur shadow-md border border-zinc-200 hover:bg-white transition-colors"
      style={{
        width: "clamp(2rem, 2.4vw, 2.8rem)",
        height: "clamp(2rem, 2.4vw, 2.8rem)",
        color: accent,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ width: "55%", height: "55%" }}
      >
        {isFs ? (
          <>
            <path d="M9 4v3a2 2 0 0 1-2 2H4" />
            <path d="M15 4v3a2 2 0 0 0 2 2h3" />
            <path d="M9 20v-3a2 2 0 0 0-2-2H4" />
            <path d="M15 20v-3a2 2 0 0 1 2-2h3" />
          </>
        ) : (
          <>
            <path d="M4 9V6a2 2 0 0 1 2-2h3" />
            <path d="M20 9V6a2 2 0 0 0-2-2h-3" />
            <path d="M4 15v3a2 2 0 0 0 2 2h3" />
            <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
          </>
        )}
      </svg>
    </button>
  );
}
