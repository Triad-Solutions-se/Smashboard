"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { updateMatchScore } from "@/lib/db/matches";
import { computeStandings, shortTeamName, teamName } from "@/lib/standings";
import type {
  Court,
  Player,
  Tenant,
  Tournament,
  TournamentGroup,
  TournamentMatch,
  TournamentTeam,
} from "@/lib/supabase/types";

type Loaded = {
  groups: TournamentGroup[];
  teams: TournamentTeam[];
  matches: TournamentMatch[];
  players: Player[];
  courts: Court[];
};

// ─── Root ────────────────────────────────────────────────────────────────────

export function PlayView({
  tenant,
  tournament: initialTournament,
}: {
  tenant: Tenant;
  tournament: Tournament;
}) {
  const storageKey = `smashboard:team:${initialTournament.id}`;

  const [data, setData] = useState<Loaded | null>(null);
  const [tournament, setTournament] = useState(initialTournament);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(storageKey);
  });
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const accent = tenant.primary_color || "#10b981";

  const load = useCallback(async () => {
    const [tRes, gRes, teamsRes, mRes, pRes, cRes] = await Promise.all([
      supabaseClient.from("tournaments").select("*").eq("id", initialTournament.id).single(),
      supabaseClient.from("tournament_groups").select("*").eq("tournament_id", initialTournament.id).order("sort_order"),
      supabaseClient.from("tournament_teams").select("*").eq("tournament_id", initialTournament.id),
      supabaseClient.from("tournament_matches").select("*").eq("tournament_id", initialTournament.id).order("round_number"),
      supabaseClient.from("players").select("*").eq("tenant_id", tenant.id),
      supabaseClient.from("courts").select("*").eq("tenant_id", tenant.id).order("sort_order"),
    ]);
    if (tRes.error) throw tRes.error;
    if (gRes.error) throw gRes.error;
    if (teamsRes.error) throw teamsRes.error;
    if (mRes.error) throw mRes.error;
    if (pRes.error) throw pRes.error;
    if (cRes.error) throw cRes.error;
    setTournament(tRes.data as Tournament);
    setData({
      groups: gRes.data ?? [],
      teams: teamsRes.data ?? [],
      matches: mRes.data ?? [],
      players: pRes.data ?? [],
      courts: cRes.data ?? [],
    });
  }, [initialTournament.id, tenant.id]);

  useEffect(() => {
    load().catch((e) => setLoadErr((e as Error).message));
  }, [load]);

  // Clear stale team selection if the stored team no longer exists in this tournament
  useEffect(() => {
    if (!data || !selectedTeamId) return;
    const exists = data.teams.some((t) => t.id === selectedTeamId);
    if (!exists) {
      localStorage.removeItem(storageKey);
      setSelectedTeamId(null);
    }
  }, [data, selectedTeamId, storageKey]);

  useEffect(() => {
    const channel = supabaseClient
      .channel(`play:${initialTournament.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches", filter: `tournament_id=eq.${initialTournament.id}` }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${initialTournament.id}` }, () => { void load(); })
      .subscribe();

    // On mobile, WebSocket drops when browser backgrounds or screen locks.
    // Reload whenever the tab becomes visible again so the lock state is always fresh.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);

    // Periodic fallback for stubborn network conditions (every 15 s).
    const timer = setInterval(() => { void load(); }, 15_000);

    return () => {
      void supabaseClient.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [initialTournament.id, load]);

  if (loadErr) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-red-600 text-sm text-center">{loadErr}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        <PageHeader
          tenant={tenant}
          tournament={tournament}
          accent={accent}
          showBack={!!selectedTeamId}
          onBack={() => { localStorage.removeItem(storageKey); setSelectedTeamId(null); }}
        />

        {!data ? (
          <div className="py-16 text-center text-sm text-zinc-400 animate-pulse">Laddar…</div>
        ) : selectedTeamId ? (
          <Dashboard
            tournament={tournament}
            data={data}
            selectedTeamId={selectedTeamId}
            accent={accent}
          />
        ) : (
          <TeamPicker data={data} accent={accent} onSelect={(id) => { localStorage.setItem(storageKey, id); setSelectedTeamId(id); }} />
        )}
      </div>
    </div>
  );
}

// ─── Page header ─────────────────────────────────────────────────────────────

function PageHeader({
  tenant,
  tournament,
  accent,
  showBack,
  onBack,
}: {
  tenant: Tenant;
  tournament: Tournament;
  accent: string;
  showBack: boolean;
  onBack: () => void;
}) {
  return (
    <header className="flex items-center gap-3">
      {showBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-100 hover:bg-zinc-200 transition shrink-0"
          aria-label="Byt lag"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-zinc-600" aria-hidden="true">
            <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
      ) : tenant.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logo_url} alt="" className="h-9 w-auto shrink-0" />
      ) : (
        <span
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg font-black text-sm shrink-0"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          {tenant.name.charAt(0)}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-zinc-500 truncate">{tenant.name}</p>
        <h1 className="text-lg font-semibold leading-tight truncate">{tournament.name}</h1>
      </div>
    </header>
  );
}

// ─── Step 1: Team picker ──────────────────────────────────────────────────────

function TeamPicker({
  data,
  accent,
  onSelect,
}: {
  data: Loaded;
  accent: string;
  onSelect: (teamId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const playerMap = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return data.teams;
    return data.teams.filter((t) => {
      const p1 = playerMap.get(t.player1_id);
      const p2 = t.player2_id ? playerMap.get(t.player2_id) : null;
      const name = `${p1?.name ?? ""} ${p2?.name ?? ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [data.teams, playerMap, query]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-zinc-800">Välj ditt lag</h2>
        <p className="text-sm text-zinc-500 mt-0.5">Tryck på laget du spelar i.</p>
      </div>

      <input
        type="search"
        placeholder="Sök spelare…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:border-transparent"
        style={{ "--tw-ring-color": accent } as React.CSSProperties}
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-6">Inga lag hittades.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((team) => {
            const p1 = playerMap.get(team.player1_id);
            const p2 = team.player2_id ? playerMap.get(team.player2_id) : null;
            return (
              <li key={team.id}>
                <button
                  type="button"
                  onClick={() => onSelect(team.id)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-left hover:border-zinc-300 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-zinc-900">{p1?.name ?? "?"}</p>
                      {p2 && <p className="text-sm text-zinc-500 mt-0.5">{p2.name}</p>}
                    </div>
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-zinc-300 shrink-0" aria-hidden="true">
                      <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06L7.28 11.78a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Step 2: Dashboard ────────────────────────────────────────────────────────

function Dashboard({
  tournament,
  data,
  selectedTeamId,
  accent,
}: {
  tournament: Tournament;
  data: Loaded;
  selectedTeamId: string;
  accent: string;
}) {
  const playerMap = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const courtMap = useMemo(() => new Map(data.courts.map((c) => [c.id, c])), [data.courts]);
  const teamMap = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams]);

  const myTeam = teamMap.get(selectedTeamId);

  const myGroupMatches = useMemo(() => {
    return data.matches.filter(
      (m) => m.stage === "group" && (m.team1_id === selectedTeamId || m.team2_id === selectedTeamId)
    );
  }, [data.matches, selectedTeamId]);

  const currentMatch = useMemo(
    () => myGroupMatches.find((m) => m.round_number === tournament.current_round),
    [myGroupMatches, tournament.current_round]
  );

  const upcomingMatches = useMemo(
    () => myGroupMatches.filter((m) => m.round_number > tournament.current_round).sort((a, b) => a.round_number - b.round_number),
    [myGroupMatches, tournament.current_round]
  );

  // standings for my group only
  const myGroupId = myTeam?.group_id ?? null;
  const groupStandings = useMemo(() => {
    if (!myGroupId) return [];
    const groupTeams = data.teams.filter((t) => t.group_id === myGroupId);
    const groupMatches = data.matches.filter((m) => m.group_id === myGroupId && m.stage === "group");
    return computeStandings(groupTeams, groupMatches, playerMap);
  }, [myGroupId, data.teams, data.matches, playerMap]);

  const myGroup = data.groups.find((g) => g.id === myGroupId);

  // Detect if any team in the current match is still finishing an earlier round
  const blockingTeams = useMemo(() => {
    if (!currentMatch) return [];
    const blocking: TournamentTeam[] = [];
    for (const teamId of [currentMatch.team1_id, currentMatch.team2_id]) {
      const stillBusy = data.matches.some(
        (m) =>
          m.round_number < currentMatch.round_number &&
          m.status !== "completed" &&
          (m.team1_id === teamId || m.team2_id === teamId)
      );
      if (stillBusy) {
        const t = teamMap.get(teamId);
        if (t) blocking.push(t);
      }
    }
    return blocking;
  }, [currentMatch, data.matches, teamMap]);

  const isLocked = blockingTeams.length > 0;

  if (!myTeam) return null;

  return (
    <div className="space-y-4">
      {/* Current round match */}
      <section>
        <SectionLabel>Runda {tournament.current_round}</SectionLabel>
        {currentMatch ? (
          <MatchCard
            match={currentMatch}
            myTeamId={selectedTeamId}
            teamMap={teamMap}
            playerMap={playerMap}
            courtMap={courtMap}
            gamesPerMatch={tournament.games_per_match}
            accent={accent}
            isLocked={isLocked}
            blockingTeams={blockingTeams}
          />
        ) : (
          <EmptyCard>Du vilar denna runda.</EmptyCard>
        )}
      </section>

      {/* Upcoming matches */}
      {upcomingMatches.length > 0 && (
        <section>
          <SectionLabel>Kommande matcher</SectionLabel>
          <div className="space-y-2">
            {upcomingMatches.map((m) => (
              <UpcomingMatchRow
                key={m.id}
                match={m}
                myTeamId={selectedTeamId}
                teamMap={teamMap}
                playerMap={playerMap}
                courtMap={courtMap}
                accent={accent}
              />
            ))}
          </div>
        </section>
      )}

      {/* Group standings */}
      {groupStandings.length > 0 && (
        <section>
          <SectionLabel>{myGroup?.name ?? "Grupp"} – ställning</SectionLabel>
          <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-400 border-b border-zinc-100">
                  <th className="pl-4 pr-2 py-2 text-left font-medium w-6">#</th>
                  <th className="px-2 py-2 text-left font-medium">Lag</th>
                  <th className="px-2 py-2 text-right font-medium">M</th>
                  <th className="px-2 py-2 text-right font-medium">+</th>
                  <th className="pr-4 pl-2 py-2 text-right font-medium">−</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {groupStandings.map((row, i) => {
                  const isMe = row.team_id === selectedTeamId;
                  return (
                    <tr
                      key={row.team_id}
                      className={isMe ? "font-semibold" : ""}
                      style={isMe ? { backgroundColor: `${accent}10` } : undefined}
                    >
                      <td className="pl-4 pr-2 py-2.5 text-zinc-400 text-xs">{i + 1}</td>
                      <td className="px-2 py-2.5 truncate max-w-[160px]">
                        <span style={isMe ? { color: accent } : undefined}>{row.teamName}</span>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-zinc-600">{row.mp}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-zinc-600">{row.gf}</td>
                      <td className="pr-4 pl-2 py-2.5 text-right tabular-nums text-zinc-600">{row.ga}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Match card (current round) ───────────────────────────────────────────────

function MatchCard({
  match,
  myTeamId,
  teamMap,
  playerMap,
  courtMap,
  gamesPerMatch,
  accent,
  isLocked,
  blockingTeams,
}: {
  match: TournamentMatch;
  myTeamId: string;
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  courtMap: Map<string, Court>;
  gamesPerMatch: number;
  accent: string;
  isLocked: boolean;
  blockingTeams: TournamentTeam[];
}) {
  const iAmTeam1 = match.team1_id === myTeamId;
  const opponentId = iAmTeam1 ? match.team2_id : match.team1_id;
  const opponent = teamMap.get(opponentId);
  const court = match.court_id ? courtMap.get(match.court_id) : null;
  const reported = match.status === "completed";

  const myScore = iAmTeam1 ? match.score_team1 : match.score_team2;
  const oppScore = iAmTeam1 ? match.score_team2 : match.score_team1;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      {/* Court — prominent banner */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-2"
        style={{ backgroundColor: `${accent}12` }}
      >
        <span className="text-xl font-black tracking-tight" style={{ color: accent }}>
          {court ? court.name : "Bana okänd"}
        </span>
        {reported ? (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${accent}18`, color: accent }}
          >
            Rapporterat
          </span>
        ) : isLocked ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
            Väntar
          </span>
        ) : (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
            Pågår
          </span>
        )}
      </div>

      {/* Matchup */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-400 mb-0.5">Ni</p>
            <p className="font-semibold text-zinc-900 truncate" style={{ color: accent }}>
              {shortTeamName(teamMap.get(myTeamId)!, playerMap)}
            </p>
          </div>
          {reported ? (
            <div className="text-2xl font-black tabular-nums shrink-0" style={{ color: accent }}>
              {myScore ?? "–"}<span className="text-zinc-300 mx-1">–</span>{oppScore ?? "–"}
            </div>
          ) : (
            <div className="text-lg font-bold text-zinc-300 shrink-0">vs</div>
          )}
          <div className="flex-1 min-w-0 text-right">
            <p className="text-xs text-zinc-400 mb-0.5">Motståndare</p>
            <p className="font-semibold text-zinc-700 truncate">
              {opponent ? shortTeamName(opponent, playerMap) : "?"}
            </p>
          </div>
        </div>
      </div>

      {/* Locked — waiting for another match to finish */}
      {!reported && isLocked && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-4 flex items-start gap-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Väntar på pågående match</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {blockingTeams.map((t) => shortTeamName(t, playerMap)).join(" & ")} spelar fortfarande sin föregående match.
            </p>
          </div>
        </div>
      )}

      {/* Score form — only when not reported and not locked */}
      {!reported && !isLocked && (
        <div className="border-t border-zinc-100 px-4 py-4">
          <ScoreForm
            match={match}
            myTeamId={myTeamId}
            gamesPerMatch={gamesPerMatch}
            accent={accent}
            opponentName={opponent ? shortTeamName(opponent, playerMap) : "Motståndare"}
          />
        </div>
      )}
    </div>
  );
}

// ─── Score form ───────────────────────────────────────────────────────────────

function ScoreForm({
  match,
  myTeamId,
  gamesPerMatch,
  accent,
  opponentName,
}: {
  match: TournamentMatch;
  myTeamId: string;
  gamesPerMatch: number;
  accent: string;
  opponentName: string;
}) {
  const iAmTeam1 = match.team1_id === myTeamId;
  const [myVal, setMyVal] = useState("");
  const [oppVal, setOppVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const myScore = myVal === "" ? null : parseInt(myVal, 10);
  const oppScore = oppVal === "" ? null : parseInt(oppVal, 10);
  const bothFilled = myScore !== null && oppScore !== null && !isNaN(myScore) && !isNaN(oppScore);
  const valid =
    bothFilled &&
    myScore! >= 0 &&
    oppScore! >= 0 &&
    Math.max(myScore!, oppScore!) === gamesPerMatch &&
    Math.min(myScore!, oppScore!) < gamesPerMatch;

  async function submit() {
    if (!valid || myScore === null || oppScore === null) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      const s1 = iAmTeam1 ? myScore : oppScore;
      const s2 = iAmTeam1 ? oppScore : myScore;
      await updateMatchScore(match.id, s1, s2);
      setDone(true);
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm font-medium text-center py-1" style={{ color: accent }}>
        Resultatet är sparat!
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Ange matchresultatet (vinnaren spelar {gamesPerMatch} gem)</p>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* My score */}
        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Ni</label>
          <input
            type="number"
            min="0"
            max={gamesPerMatch}
            inputMode="numeric"
            value={myVal}
            onChange={(e) => setMyVal(e.target.value)}
            placeholder="0"
            className="w-full text-center text-2xl font-bold rounded-lg border border-zinc-200 py-3 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ "--tw-ring-color": accent } as React.CSSProperties}
          />
        </div>

        <span className="text-zinc-300 font-bold text-lg mt-5">–</span>

        {/* Opponent score */}
        <div className="space-y-1">
          <label className="text-xs text-zinc-400 truncate block text-right">{opponentName}</label>
          <input
            type="number"
            min="0"
            max={gamesPerMatch}
            inputMode="numeric"
            value={oppVal}
            onChange={(e) => setOppVal(e.target.value)}
            placeholder="0"
            className="w-full text-center text-2xl font-bold rounded-lg border border-zinc-200 py-3 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ "--tw-ring-color": accent } as React.CSSProperties}
          />
        </div>
      </div>

      {bothFilled && !valid && (
        <p className="text-xs text-amber-600">
          Vinnaren måste ha {gamesPerMatch} gem.
        </p>
      )}

      {submitErr && <p className="text-xs text-red-600">{submitErr}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!valid || busy}
        className="w-full rounded-xl py-3 text-sm font-semibold text-white transition disabled:opacity-40 active:scale-[0.99]"
        style={{ backgroundColor: accent }}
      >
        {busy ? "Sparar…" : "Rapportera resultat"}
      </button>
    </div>
  );
}

// ─── Upcoming match row ───────────────────────────────────────────────────────

function UpcomingMatchRow({
  match,
  myTeamId,
  teamMap,
  playerMap,
  courtMap,
  accent,
}: {
  match: TournamentMatch;
  myTeamId: string;
  teamMap: Map<string, TournamentTeam>;
  playerMap: Map<string, Player>;
  courtMap: Map<string, Court>;
  accent: string;
}) {
  const opponentId = match.team1_id === myTeamId ? match.team2_id : match.team1_id;
  const opponent = teamMap.get(opponentId);
  const court = match.court_id ? courtMap.get(match.court_id) : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 flex items-center gap-3">
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: `${accent}18`, color: accent }}
      >
        {match.round_number}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-800 truncate">
          mot {opponent ? shortTeamName(opponent, playerMap) : "?"}
        </p>
        {court && <p className="text-xs text-zinc-400 mt-0.5">{court.name}</p>}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">{children}</h2>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-400 text-center">
      {children}
    </div>
  );
}
