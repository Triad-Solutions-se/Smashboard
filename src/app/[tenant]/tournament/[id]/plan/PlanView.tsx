"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import type {
  Tenant,
  Tournament,
  TournamentFormat,
  TournamentTeam,
  Player,
  TournamentRegistration,
} from "@/lib/supabase/types";
import {
  updateDraftPlan,
  addDraftTeam,
  updateDraftTeam,
  deleteDraftTeam,
  setPlayerPaid,
} from "@/lib/db/tournaments";
import { PaymentPanel, type PaymentPlayerRow } from "@/components/PaymentPanel";
import {
  setTournamentRegistrationOpen,
  approveRegistration,
  cancelRegistration,
} from "@/lib/db/registrations";
import {
  PlayerCombobox,
  type PlayerComboboxHandle,
} from "@/components/PlayerCombobox";

const FORMAT_OPTIONS: { value: TournamentFormat; label: string; available: boolean }[] = [
  { value: "gruppspel", label: "Gruppspel", available: true },
  { value: "mexicano", label: "Mexicano (Kommer snart)", available: false },
  { value: "americano", label: "Americano (Kommer snart)", available: false },
  { value: "team_mexicano", label: "Lag-Mexicano (Kommer snart)", available: false },
];

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlanView({
  tenant,
  tournament,
  initialTeams,
  players,
  initialRegistrations,
}: {
  tenant: Tenant;
  tournament: Tournament;
  initialTeams: TournamentTeam[];
  players: Player[];
  initialRegistrations: TournamentRegistration[];
}) {
  const router = useRouter();
  const accent = tenant.primary_color || "#10b981";

  const [name, setName] = useState(tournament.name);
  const [format, setFormat] = useState<TournamentFormat>(tournament.format);
  const [scheduledLocal, setScheduledLocal] = useState(
    toLocalInputValue(tournament.scheduled_at)
  );
  const [savingMeta, setSavingMeta] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [teams, setTeams] = useState<TournamentTeam[]>(initialTeams);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [planTab, setPlanTab] = useState<"lag" | "betalning">("lag");
  const [teamSearch, setTeamSearch] = useState("");

  const [openReg, setOpenReg] = useState(tournament.open_registration);
  const [maxTeamsInput, setMaxTeamsInput] = useState(
    tournament.max_teams != null ? String(tournament.max_teams) : ""
  );
  const [savingReg, setSavingReg] = useState(false);
  const [registrations, setRegistrations] =
    useState<TournamentRegistration[]>(initialRegistrations);
  const [busyRegId, setBusyRegId] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabaseClient
      .channel(`plan-registrations-${tournament.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tournament_registrations",
          filter: `tournament_id=eq.${tournament.id}`,
        },
        (payload) => {
          const incoming = payload.new as TournamentRegistration;
          setRegistrations((prev) => {
            if (prev.some((r) => r.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
        }
      )
      .subscribe();

    return () => { void supabaseClient.removeChannel(channel); };
  }, [tournament.id]);

  const playerMap = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const assignedSet = useMemo(() => {
    const s = new Set<string>();
    for (const t of teams) {
      s.add(t.player1_id);
      if (t.player2_id) s.add(t.player2_id);
    }
    return s;
  }, [teams]);

  const unassignedPlayers = useMemo(
    () => players.filter((p) => !assignedSet.has(p.id)),
    [players, assignedSet]
  );

  const completeTeams = teams.filter((t) => t.player1_id && t.player2_id);
  const soloTeams = teams.filter((t) => t.player1_id && !t.player2_id);

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => {
      const p1 = playerMap.get(t.player1_id)?.name.toLowerCase() ?? "";
      const p2 = t.player2_id ? (playerMap.get(t.player2_id)?.name.toLowerCase() ?? "") : "";
      return p1.includes(q) || p2.includes(q);
    });
  }, [teams, teamSearch, playerMap]);

  const filteredUnassigned = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return unassignedPlayers;
    return unassignedPlayers.filter((p) => p.name.toLowerCase().includes(q));
  }, [unassignedPlayers, teamSearch]);

  async function saveMeta() {
    setErr(null);
    setSavingMeta(true);
    try {
      await updateDraftPlan(tournament.id, {
        name: name.trim() || tournament.name,
        format,
        scheduled_at: scheduledLocal
          ? new Date(scheduledLocal).toISOString()
          : null,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingMeta(false);
    }
  }

  async function addTeam(p1: string, p2: string | null) {
    setErr(null);
    try {
      const created = await addDraftTeam(tournament.id, p1, p2);
      setTeams((prev) => [...prev, created]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function setSlot(
    teamId: string,
    slot: "player1_id" | "player2_id",
    value: string | null
  ) {
    const prev = teams.find((t) => t.id === teamId);
    if (!prev) return;
    if (slot === "player1_id" && !value) {
      setErr("Lag måste ha minst en spelare. Ta bort laget istället.");
      return;
    }
    const next = { ...prev, [slot]: value };
    setBusyTeamId(teamId);
    try {
      await updateDraftTeam(teamId, {
        player1_id: next.player1_id,
        player2_id: next.player2_id,
      });
      setTeams((prevTeams) =>
        prevTeams.map((t) => (t.id === teamId ? next : t))
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyTeamId(null);
    }
  }

  async function removeTeam(teamId: string) {
    setBusyTeamId(teamId);
    try {
      await deleteDraftTeam(teamId);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyTeamId(null);
    }
  }

  async function saveRegistrationSettings(
    next: { open: boolean; maxTeams: number | null }
  ) {
    setErr(null);
    setSavingReg(true);
    try {
      await setTournamentRegistrationOpen(
        tournament.id,
        next.open,
        next.maxTeams
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingReg(false);
    }
  }

  async function toggleOpenReg(open: boolean) {
    if (open) {
      const n = parseInt(maxTeamsInput, 10);
      if (!Number.isFinite(n) || n <= 0) {
        setErr("Sätt ett antal platser först.");
        return;
      }
      setOpenReg(true);
      await saveRegistrationSettings({ open: true, maxTeams: n });
    } else {
      setOpenReg(false);
      await saveRegistrationSettings({ open: false, maxTeams: null });
    }
  }

  async function commitMaxTeams() {
    if (!openReg) return;
    const n = parseInt(maxTeamsInput, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    await saveRegistrationSettings({ open: true, maxTeams: n });
  }

  async function approveReg(id: string) {
    setBusyRegId(id);
    setErr(null);
    try {
      const updated = await approveRegistration(id);
      setRegistrations((prev) =>
        prev.map((r) => (r.id === id ? updated : r))
      );
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRegId(null);
    }
  }

  async function dismissReg(id: string) {
    setBusyRegId(id);
    setErr(null);
    try {
      await cancelRegistration(id);
      setRegistrations((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRegId(null);
    }
  }

  function metaDirty() {
    return (
      name.trim() !== tournament.name ||
      format !== tournament.format ||
      scheduledLocal !== toLocalInputValue(tournament.scheduled_at)
    );
  }

  async function setPaid(teamId: string, slot: 1 | 2, paid: boolean) {
    await setPlayerPaid(teamId, slot, paid);
    const next = paid ? new Date().toISOString() : null;
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? { ...t, [slot === 1 ? "player1_paid_at" : "player2_paid_at"]: next }
          : t
      )
    );
  }

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
          paid: t.player1_paid_at != null,
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
            paid: t.player2_paid_at != null,
          });
        }
      }
    }
    return rows;
  }, [teams, playerMap]);

  function goStart() {
    router.push(`/${tenant.slug}/tournament/${tournament.id}/start`);
  }

  const showsTeams = format === "gruppspel" || format === "team_mexicano";

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href={`/${tenant.slug}`}
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            ← Sessioner
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Planera session</h1>
          <p className="text-sm text-zinc-500">
            Utkast — sparas automatiskt. Du kan ändra fram till start.
          </p>
        </div>
        <button
          onClick={goStart}
          disabled={teams.length < 2}
          className="px-5 py-2.5 rounded-md text-white text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: accent }}
          title={
            teams.length < 2
              ? "Minst 2 lag/spelare krävs"
              : "Sätt upp banor, regler och starta"
          }
        >
          Starta session →
        </button>
      </header>

      {err && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700 flex items-center justify-between">
          <span>{err}</span>
          <button
            onClick={() => setErr(null)}
            className="text-red-700 text-xs underline"
          >
            stäng
          </button>
        </div>
      )}

      <main className="p-6 grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-700">Detaljer</h2>
            <div>
              <label className="text-xs font-medium block mb-1 text-zinc-500">
                Namn
              </label>
              <input
                className="w-full px-3 py-2 rounded-md border border-zinc-300 bg-white"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => metaDirty() && saveMeta()}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1 text-zinc-500">
                Speltyp
              </label>
              <select
                className="w-full px-3 py-2 rounded-md border border-zinc-300 bg-white"
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as TournamentFormat);
                }}
                onBlur={() => metaDirty() && saveMeta()}
              >
                {FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} disabled={!o.available && o.value !== format}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1 text-zinc-500">
                Datum & tid
              </label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 rounded-md border border-zinc-300 bg-white"
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
                onBlur={() => metaDirty() && saveMeta()}
              />
            </div>
            <div className="text-xs text-zinc-400">
              {savingMeta
                ? "Sparar…"
                : savedAt
                  ? "Sparat"
                  : "Ändringar sparas när du lämnar fältet"}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-700 mb-2">
              Spelarbas
            </h2>
            <p className="text-xs text-zinc-500 mb-3">
              {assignedSet.size} av {players.length} spelare med
            </p>
            <Link
              href={`/${tenant.slug}/players`}
              className="inline-block px-3 py-1.5 rounded-md text-xs font-medium border border-zinc-200 hover:bg-zinc-50"
            >
              Hantera spelare →
            </Link>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700">
                Öppna anmälan
              </h2>
              <button
                type="button"
                onClick={() => toggleOpenReg(!openReg)}
                disabled={savingReg}
                aria-pressed={openReg}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:opacity-50 ${
                  openReg ? "" : "bg-zinc-300"
                }`}
                style={openReg ? { backgroundColor: accent } : undefined}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    openReg ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Ger spelare en länk att anmäla sig själva på{" "}
              <span className="font-mono">/play</span>.
            </p>
            <div>
              <label className="text-xs font-medium block mb-1 text-zinc-500">
                Antal platser (lag)
              </label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className="w-full px-3 py-2 rounded-md border border-zinc-300 bg-white"
                value={maxTeamsInput}
                onChange={(e) => setMaxTeamsInput(e.target.value)}
                onBlur={commitMaxTeams}
                placeholder="t.ex. 8"
              />
            </div>
            {openReg && (
              <div className="text-xs text-zinc-500 break-all">
                <a
                  href={`/${tenant.slug}/play/${tournament.id}`}
                  className="underline"
                  style={{ color: accent }}
                >
                  Öppna kundvyn →
                </a>
              </div>
            )}
          </div>

          {registrations.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-700 mb-3">
                Anmälningar ({registrations.length})
              </h2>
              <ul className="space-y-2">
                {registrations.map((r) => {
                  const pending = r.status === "pending";
                  return (
                    <li
                      key={r.id}
                      className="rounded-lg border border-zinc-200 p-2.5 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {r.player1_name}
                            {r.player2_name ? ` & ${r.player2_name}` : ""}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            {r.player1_phone || "—"}
                            {r.player2_name
                              ? ` · ${r.player2_phone || "—"}`
                              : ""}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                            pending ? "text-amber-600" : "text-emerald-600"
                          }`}
                        >
                          {pending ? "Reserv" : "Med"}
                        </span>
                      </div>
                      {pending && (
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => approveReg(r.id)}
                            disabled={busyRegId === r.id}
                            className="px-2.5 py-1 rounded text-xs font-semibold text-white disabled:opacity-50"
                            style={{ backgroundColor: accent }}
                          >
                            Släpp in
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissReg(r.id)}
                            disabled={busyRegId === r.id}
                            className="px-2.5 py-1 rounded text-xs font-medium text-zinc-500 hover:text-red-500 disabled:opacity-50"
                          >
                            Ta bort
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white">
            <div className="flex items-center gap-0 border-b border-zinc-200 px-4 pt-3">
              {(["lag", "betalning"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPlanTab(t)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                    planTab === t
                      ? "text-zinc-900"
                      : "text-zinc-500 border-transparent hover:text-zinc-700"
                  }`}
                  style={planTab === t ? { borderColor: accent } : undefined}
                >
                  {t === "lag"
                    ? `${showsTeams ? "Lag" : "Spelare"} (${teams.length})`
                    : "Betalning"}
                </button>
              ))}
            </div>

            <div className="p-4">
              {planTab === "lag" ? (
                <>
                  <div className="mb-3">
                    {showsTeams && soloTeams.length > 0 && (
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium border border-amber-200">
                        {soloTeams.length} letar partner
                      </span>
                    )}
                    <p className="text-xs text-zinc-500 mt-1">
                      {showsTeams
                        ? "Skriv namnet på en spelare för att lägga till — para ihop dem nedan."
                        : "Skriv namnet på en spelare för att lägga till. Lag bildas vid varje runda."}
                    </p>
                  </div>

                  {teams.length > 0 && (
                    <div className="relative mb-3">
                      <input
                        type="search"
                        value={teamSearch}
                        onChange={(e) => setTeamSearch(e.target.value)}
                        placeholder="Sök spelare…"
                        className="w-full pl-8 pr-3 py-1.5 rounded-md border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      />
                      <svg
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                    </div>
                  )}

                  <AddPlayerRow
                    accent={accent}
                    paired={showsTeams}
                    options={unassignedPlayers}
                    onAdd={(p1, p2) => addTeam(p1, p2)}
                  />

                  <div className="space-y-2 mt-3">
                    {teams.length === 0 && (
                      <div className="text-center text-sm text-zinc-500 py-8 border border-dashed border-zinc-200 rounded-lg">
                        Inga {showsTeams ? "lag" : "spelare"} ännu.
                      </div>
                    )}
                    {teams.length > 0 && filteredTeams.length === 0 && (
                      <div className="text-center text-sm text-zinc-500 py-8 border border-dashed border-zinc-200 rounded-lg">
                        Ingen spelare matchar "{teamSearch}".
                      </div>
                    )}
                    {filteredTeams.map((t, idx) => (
                      <TeamRow
                        key={t.id}
                        idx={idx}
                        team={t}
                        players={players}
                        playerMap={playerMap}
                        assignedSet={assignedSet}
                        busy={busyTeamId === t.id}
                        showSecondSlot={showsTeams}
                        onChangeP1={(v) => setSlot(t.id, "player1_id", v)}
                        onChangeP2={(v) =>
                          setSlot(t.id, "player2_id", v || null)
                        }
                        onRemove={() => removeTeam(t.id)}
                      />
                    ))}
                  </div>

                  {showsTeams && soloTeams.length > 0 && (
                    <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                      {soloTeams.length} spelare letar partner. Du kan starta
                      ändå — para ihop dem i nästa steg.
                    </div>
                  )}
                </>
              ) : (
                <PaymentPanel
                  players={paymentRows}
                  accent={accent}
                  onSetPaid={setPaid}
                />
              )}
            </div>
          </div>

          {planTab === "lag" && unassignedPlayers.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-700 mb-1">
                Ej tilldelade ({unassignedPlayers.length})
              </h2>
              <p className="text-xs text-zinc-400 mb-2">Klicka för att lägga till</p>
              <div className="flex flex-wrap gap-1.5">
                {filteredUnassigned.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addTeam(p.id, null)}
                    className="px-2 py-1 rounded bg-zinc-100 text-xs hover:bg-zinc-200 transition-colors cursor-pointer"
                  >
                    + {p.name}
                  </button>
                ))}
                {filteredUnassigned.length === 0 && teamSearch.trim() && (
                  <span className="text-xs text-zinc-400">Ingen matchar sökningen.</span>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function TeamRow({
  idx,
  team,
  players,
  playerMap,
  assignedSet,
  busy,
  showSecondSlot,
  onChangeP1,
  onChangeP2,
  onRemove,
}: {
  idx: number;
  team: TournamentTeam;
  players: Player[];
  playerMap: Map<string, Player>;
  assignedSet: Set<string>;
  busy: boolean;
  showSecondSlot: boolean;
  onChangeP1: (v: string) => void;
  onChangeP2: (v: string) => void;
  onRemove: () => void;
}) {
  function optionsFor(currentValue: string | null, otherValue: string | null) {
    return players.filter(
      (p) =>
        p.id === currentValue ||
        (!assignedSet.has(p.id) && p.id !== otherValue)
    );
  }

  const isSolo = !team.player2_id;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-500">
          {showSecondSlot ? `Lag ${idx + 1}` : `Spelare ${idx + 1}`}
          {showSecondSlot && isSolo && (
            <span className="ml-2 text-amber-600">· letar partner</span>
          )}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-50"
        >
          Ta bort
        </button>
      </div>
      <div className={`grid ${showSecondSlot ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
        <PlayerCombobox
          value={team.player1_id}
          selectedName={playerMap.get(team.player1_id)?.name ?? null}
          options={optionsFor(team.player1_id, team.player2_id)}
          onSelect={onChangeP1}
          placeholder="Skriv namn…"
          disabled={busy}
        />
        {showSecondSlot && (
          <PlayerCombobox
            value={team.player2_id}
            selectedName={
              team.player2_id
                ? (playerMap.get(team.player2_id)?.name ?? null)
                : null
            }
            options={optionsFor(team.player2_id, team.player1_id)}
            onSelect={onChangeP2}
            onClear={() => onChangeP2("")}
            allowClear
            placeholder="Letar partner…"
            disabled={busy}
          />
        )}
      </div>
    </div>
  );
}

function AddPlayerRow({
  accent,
  paired,
  options,
  onAdd,
}: {
  accent: string;
  paired: boolean;
  options: Player[];
  onAdd: (p1: string, p2: string | null) => void;
}) {
  const [p1, setP1] = useState<string | null>(null);
  const ref1 = useRef<PlayerComboboxHandle>(null);
  const ref2 = useRef<PlayerComboboxHandle>(null);

  const playerById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of options) m.set(p.id, p);
    return m;
  }, [options]);

  const p1Name = p1 ? (playerById.get(p1)?.name ?? null) : null;
  const p2Options = useMemo(
    () => (p1 ? options.filter((p) => p.id !== p1) : options),
    [options, p1]
  );

  // Move focus to the second field after p1 is set — doing this in a useEffect
  // (instead of synchronously inside onSelect) ensures the second input has
  // re-rendered before we try to focus it.
  useEffect(() => {
    if (paired && p1) ref2.current?.focus();
  }, [paired, p1]);

  function reset(focusFirst = true) {
    setP1(null);
    ref1.current?.clear();
    ref2.current?.clear();
    if (focusFirst) ref1.current?.focus();
  }

  if (options.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-500">
        Alla aktiva spelare är tilldelade. Lägg till fler i Spelare.
      </div>
    );
  }

  if (!paired) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2"
        style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
      >
        <span className="text-xs font-medium text-zinc-500 px-1 shrink-0">
          + Lägg till spelare
        </span>
        <div className="flex-1">
          <PlayerCombobox
            ref={ref1}
            value={null}
            selectedName={null}
            options={options}
            onSelect={(id) => {
              onAdd(id, null);
              reset();
            }}
            placeholder="Skriv namn…"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-zinc-200 bg-zinc-50 p-2"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="text-xs font-medium text-zinc-500 px-1 mb-1.5">
        + Lägg till lag
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PlayerCombobox
          ref={ref1}
          value={p1}
          selectedName={p1Name}
          options={options}
          onSelect={(id) => setP1(id)}
          placeholder="Spelare 1 — skriv namn…"
        />
        <PlayerCombobox
          ref={ref2}
          value={null}
          selectedName={null}
          options={p2Options}
          onSelect={(id) => {
            if (!p1) return;
            onAdd(p1, id);
            reset();
          }}
          onEmptyEnter={() => {
            if (!p1) return;
            onAdd(p1, null);
            reset();
          }}
          placeholder="Spelare 2 — eller Enter för letar partner…"
        />
      </div>
    </div>
  );
}
