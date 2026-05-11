"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Tenant,
  Tournament,
  TournamentTeam,
  Court,
  Player,
  BracketMode,
} from "@/lib/supabase/types";
import {
  updateDraftTeam,
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

type Stash = {
  numGroups: number;
  gamesPerMatch: number;
  advancesPerGroup: number;
  bracketMode?: BracketMode;
  hasBronze: boolean;
  selectedCourts: string[];
  courtGroupIdx: Record<string, number>;
  qfCourtIds: string[];
  sfCourtIds: string[];
  finalCourtIds: string[];
  pairing: Record<string, string | null>;
};

type DropZone = string | "pool";

export function DrawView({
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

  const [stash, setStash] = useState<Stash | null>(null);
  const [missingStash, setMissingStash] = useState(false);
  // teamId → group sort index (0..N-1) or null = pool
  const [assignments, setAssignments] = useState<Record<string, number | null>>({});
  const [draggingTeamId, setDraggingTeamId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<DropZone | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(`draw-${tournament.id}`);
    if (!raw) {
      setMissingStash(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Stash;
      setStash(parsed);
    } catch {
      setMissingStash(true);
    }
  }, [tournament.id]);

  const playerMap = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const courtMap = useMemo(() => {
    const m = new Map<string, Court>();
    for (const c of courts) m.set(c.id, c);
    return m;
  }, [courts]);

  // Teams that will actually play — full teams + solo teams that got a partner
  // via the pairing UI on /start. Solo teams without a partner are excluded.
  const effectiveTeams = useMemo(() => {
    if (!stash) return [] as TournamentTeam[];
    return initialTeams.filter(
      (t) => !!t.player2_id || !!stash.pairing[t.id]
    );
  }, [initialTeams, stash]);

  // Initialise assignment map once we know which teams are in play.
  // Rehydrates from sessionStorage so a refresh doesn't wipe placements.
  useEffect(() => {
    if (!stash) return;
    setAssignments((prev) => {
      // If already populated for this team set, keep it.
      if (Object.keys(prev).length === effectiveTeams.length) return prev;

      let saved: Record<string, number | null> = {};
      const raw = sessionStorage.getItem(`draw-assignments-${tournament.id}`);
      if (raw) {
        try {
          saved = JSON.parse(raw) as Record<string, number | null>;
        } catch {
          saved = {};
        }
      }

      const next: Record<string, number | null> = {};
      for (const t of effectiveTeams) {
        const v = saved[t.id];
        next[t.id] =
          typeof v === "number" && v >= 0 && v < stash.numGroups ? v : null;
      }
      return next;
    });
  }, [stash, effectiveTeams, tournament.id]);

  // Persist assignments so a refresh restores them.
  useEffect(() => {
    if (Object.keys(assignments).length === 0) return;
    sessionStorage.setItem(
      `draw-assignments-${tournament.id}`,
      JSON.stringify(assignments)
    );
  }, [assignments, tournament.id]);

  const numGroups = stash?.numGroups ?? 0;

  const teamsPerGroup = useMemo(() => {
    const counts = Array<number>(numGroups).fill(0);
    for (const v of Object.values(assignments)) {
      if (typeof v === "number" && v >= 0 && v < numGroups) counts[v]++;
    }
    return counts;
  }, [assignments, numGroups]);

  const recommendedPerGroup = useMemo(() => {
    if (numGroups < 1 || effectiveTeams.length < 1) return [] as number[];
    const base = Math.floor(effectiveTeams.length / numGroups);
    const rem = effectiveTeams.length % numGroups;
    return Array.from({ length: numGroups }, (_, i) => base + (i < rem ? 1 : 0));
  }, [effectiveTeams.length, numGroups]);

  const unassignedTeams = useMemo(
    () => effectiveTeams.filter((t) => assignments[t.id] == null),
    [effectiveTeams, assignments]
  );

  const teamsByGroupIdx = useMemo(() => {
    const m: TournamentTeam[][] = Array.from({ length: numGroups }, () => []);
    for (const t of effectiveTeams) {
      const g = assignments[t.id];
      if (typeof g === "number" && g >= 0 && g < numGroups) m[g].push(t);
    }
    return m;
  }, [effectiveTeams, assignments, numGroups]);

  const allAssigned = unassignedTeams.length === 0;
  const everyGroupHasTeams = teamsPerGroup.every((c) => c >= 1);
  const canSubmit = !!stash && allAssigned && everyGroupHasTeams && !submitting;

  function moveTeam(teamId: string, target: DropZone) {
    setAssignments((prev) => ({
      ...prev,
      [teamId]: target === "pool" ? null : (target as unknown as number),
    }));
  }

  function teamLabel(t: TournamentTeam): string {
    const p1 = playerMap.get(t.player1_id)?.name ?? "?";
    const p2id = t.player2_id ?? stash?.pairing[t.id] ?? null;
    const p2 = p2id ? playerMap.get(p2id)?.name ?? "?" : null;
    return p2 ? `${p1} & ${p2}` : p1;
  }

  async function confirm() {
    if (!stash || !canSubmit) return;
    setErr(null);
    setSubmitting(true);
    try {
      // 0. Wipe any stale groups/matches from a previous attempt.
      await resetTournamentGroupData(tournament.id);

      // 1. Apply pairings to solo teams.
      const soloTeams = initialTeams.filter((t) => !t.player2_id);
      for (const t of soloTeams) {
        const partner = stash.pairing[t.id];
        if (!partner) continue;
        await updateDraftTeam(t.id, {
          player1_id: t.player1_id,
          player2_id: partner,
        });
      }

      // 2. Materialise groups from the host's drag-and-drop placement.
      const buckets = teamsByGroupIdx;

      // 3. Insert groups.
      const insertedGroups = await insertGroups(
        buckets.map((_, idx) => ({
          tournament_id: tournament.id,
          name: `Grupp ${idx + 1}`,
          sort_order: idx,
        }))
      );

      // 4. Assign group_id to each team.
      const teamsByGroup = new Map<string, TournamentTeam[]>();
      for (let gi = 0; gi < buckets.length; gi++) {
        const groupId = insertedGroups[gi].id;
        const updated: TournamentTeam[] = [];
        for (const t of buckets[gi]) {
          await assignTeamGroup(t.id, groupId);
          updated.push({ ...t, group_id: groupId });
        }
        teamsByGroup.set(groupId, updated);
      }

      // 5. Generate matches per group using the host's court selection.
      const chosenCourts = courts.filter((c) => stash.selectedCourts.includes(c.id));
      const courtsByGroupId = new Map<string, Court[]>();
      for (const g of insertedGroups) {
        const own = chosenCourts.filter(
          (c) => stash.courtGroupIdx[c.id] === g.sort_order
        );
        courtsByGroupId.set(g.id, own.length > 0 ? own : chosenCourts);
      }
      const { matches, restingByRound } = generateGroupMatches(
        teamsByGroup,
        courtsByGroupId
      );
      await insertMatches(matches);

      // 5b. Persist resting teams per round.
      const restRows: { tournament_id: string; round_number: number; team_id: string }[] = [];
      for (const [roundNumber, teamIds] of restingByRound) {
        for (const teamId of teamIds) {
          restRows.push({
            tournament_id: tournament.id,
            round_number: roundNumber,
            team_id: teamId,
          });
        }
      }
      await insertRoundRests(restRows);

      // 6. Activate tournament.
      const teamsPerGroupArr = buckets.map((b) => b.length);
      const totalRounds = totalRoundsFor(teamsPerGroupArr);
      await activateTournament(tournament.id, {
        num_groups: buckets.length,
        games_per_match: stash.gamesPerMatch,
        total_rounds: totalRounds,
        formation: "manual",
        advances_per_group: stash.advancesPerGroup > 0 ? stash.advancesPerGroup : null,
        bracket_mode: stash.bracketMode ?? "single",
        has_bronze: stash.hasBronze,
        qf_court_ids: stash.qfCourtIds,
        sf_court_ids: stash.sfCourtIds,
        final_court_ids: stash.finalCourtIds,
      });

      sessionStorage.removeItem(`draw-${tournament.id}`);
      sessionStorage.removeItem(`draw-assignments-${tournament.id}`);
      router.push(`/${tenant.slug}/tournament/${tournament.id}/host`);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  if (missingStash) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">Lottning saknas</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Lottningens inställningar hittades inte. Gå tillbaka och välj
            Manuell lottning igen.
          </p>
          <Link
            href={`/${tenant.slug}/tournament/${tournament.id}/start`}
            className="inline-block px-4 py-2 rounded-md text-white text-sm font-semibold"
            style={{ backgroundColor: accent }}
          >
            ← Tillbaka till start
          </Link>
        </div>
      </div>
    );
  }

  if (!stash) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-700 px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href={`/${tenant.slug}/tournament/${tournament.id}/start`}
            className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Tillbaka till start
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Lotta lag</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Dra varje lag till en grupp. {teamsPerGroup.reduce((a, b) => a + b, 0)} av{" "}
            {effectiveTeams.length} lag fördelade.
          </p>
        </div>
        <button
          onClick={confirm}
          disabled={!canSubmit}
          className="px-5 py-2.5 rounded-md text-white text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: accent }}
          title={
            !allAssigned
              ? "Fördela alla lag först"
              : !everyGroupHasTeams
                ? "Varje grupp behöver minst ett lag"
                : "Starta sessionen"
          }
        >
          {submitting ? "Startar…" : "Starta session →"}
        </button>
      </header>

      {err && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {err}
        </div>
      )}

      <main className="p-6 space-y-5">
        <PoolZone
          teams={unassignedTeams}
          dragOver={dragOverZone === "pool"}
          draggingTeamId={draggingTeamId}
          onDragStart={(id) => setDraggingTeamId(id)}
          onDragEnd={() => {
            setDraggingTeamId(null);
            setDragOverZone(null);
          }}
          onDragEnter={() => setDragOverZone("pool")}
          onDragLeave={() =>
            setDragOverZone((prev) => (prev === "pool" ? null : prev))
          }
          onDrop={(id) => {
            moveTeam(id, "pool");
            setDragOverZone(null);
          }}
          teamLabel={teamLabel}
          accent={accent}
        />

        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${Math.min(numGroups, 4)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: numGroups }, (_, idx) => {
            const teamsHere = teamsByGroupIdx[idx];
            const rec = recommendedPerGroup[idx] ?? 0;
            const count = teamsPerGroup[idx];
            const courtsForGroup = stash.selectedCourts
              .filter((cid) => stash.courtGroupIdx[cid] === idx)
              .map((cid) => courtMap.get(cid)?.name ?? "?");
            return (
              <GroupColumn
                key={idx}
                idx={idx}
                count={count}
                recommended={rec}
                courtsLabel={courtsForGroup.join(" · ")}
                teams={teamsHere}
                dragOver={dragOverZone === String(idx)}
                draggingTeamId={draggingTeamId}
                onDragStart={(id) => setDraggingTeamId(id)}
                onDragEnd={() => {
                  setDraggingTeamId(null);
                  setDragOverZone(null);
                }}
                onDragEnter={() => setDragOverZone(String(idx))}
                onDragLeave={() =>
                  setDragOverZone((prev) =>
                    prev === String(idx) ? null : prev
                  )
                }
                onDrop={(id) => {
                  setAssignments((prev) => ({ ...prev, [id]: idx }));
                  setDragOverZone(null);
                }}
                teamLabel={teamLabel}
                accent={accent}
              />
            );
          })}
        </div>
      </main>
    </div>
  );
}

function TeamCard({
  team,
  label,
  draggingTeamId,
  onDragStart,
  onDragEnd,
  accent,
}: {
  team: TournamentTeam;
  label: string;
  draggingTeamId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  accent: string;
}) {
  const isDragging = draggingTeamId === team.id;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", team.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(team.id);
      }}
      onDragEnd={onDragEnd}
      className={`px-3 py-2 rounded-md border bg-white dark:bg-zinc-900 text-sm font-medium cursor-grab active:cursor-grabbing select-none transition ${
        isDragging
          ? "opacity-40 border-dashed"
          : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
      }`}
      style={!isDragging ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
    >
      {label}
    </div>
  );
}

function PoolZone({
  teams,
  dragOver,
  draggingTeamId,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
  teamLabel,
  accent,
}: {
  teams: TournamentTeam[];
  dragOver: boolean;
  draggingTeamId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (id: string) => void;
  teamLabel: (t: TournamentTeam) => string;
  accent: string;
}) {
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDrop(id);
      }}
      className={`rounded-xl border bg-white dark:bg-zinc-900 p-4 transition ${
        dragOver
          ? "border-zinc-900 dark:border-zinc-100"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Lag att fördela
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {teams.length} kvar
        </span>
      </div>
      {teams.length === 0 ? (
        <div className="text-xs text-zinc-400 dark:text-zinc-500 italic">
          Alla lag är fördelade. Dra hit för att flytta tillbaka.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              label={teamLabel(t)}
              draggingTeamId={draggingTeamId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              accent={accent}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GroupColumn({
  idx,
  count,
  recommended,
  courtsLabel,
  teams,
  dragOver,
  draggingTeamId,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
  teamLabel,
  accent,
}: {
  idx: number;
  count: number;
  recommended: number;
  courtsLabel: string;
  teams: TournamentTeam[];
  dragOver: boolean;
  draggingTeamId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (id: string) => void;
  teamLabel: (t: TournamentTeam) => string;
  accent: string;
}) {
  const off = recommended > 0 && count !== recommended;
  const hintColor = count === recommended ? "#71717a" : count < recommended ? "#d97706" : "#71717a";
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDrop(id);
      }}
      className={`min-h-[260px] rounded-xl border-2 bg-white dark:bg-zinc-900 p-3 transition flex flex-col ${
        dragOver
          ? "border-zinc-900 dark:border-zinc-100"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="mb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Grupp {idx + 1}</h3>
          <span
            className="text-xs font-medium tabular-nums"
            style={{ color: count === 0 ? "#a1a1aa" : accent }}
          >
            {count} lag
          </span>
        </div>
        {recommended > 0 && (
          <div className="text-[11px] mt-0.5" style={{ color: hintColor }}>
            {off
              ? `rekommenderat ${recommended}`
              : `${recommended} rekommenderat`}
          </div>
        )}
        {courtsLabel && (
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">
            {courtsLabel}
          </div>
        )}
      </div>
      <div className="flex-1 space-y-1.5">
        {teams.length === 0 ? (
          <div className="h-full min-h-[100px] flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-600 italic border border-dashed border-zinc-200 dark:border-zinc-700 rounded-md">
            Dra hit
          </div>
        ) : (
          teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              label={teamLabel(t)}
              draggingTeamId={draggingTeamId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              accent={accent}
            />
          ))
        )}
      </div>
    </section>
  );
}
