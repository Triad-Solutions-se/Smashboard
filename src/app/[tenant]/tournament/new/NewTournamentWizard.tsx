"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Tenant, TournamentFormat } from "@/lib/supabase/types";
import { createDraftTournament } from "@/lib/db/tournaments";

const FORMAT_OPTIONS: { value: TournamentFormat; label: string; available: boolean }[] = [
  { value: "gruppspel", label: "Gruppspel", available: true },
  { value: "mexicano", label: "Mexicano (Kommer snart)", available: false },
  { value: "americano", label: "Americano (Kommer snart)", available: false },
  { value: "team_mexicano", label: "Lag-Mexicano (Kommer snart)", available: false },
];

function defaultScheduledAt(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewTournamentWizard({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const accent = tenant.primary_color || "#10b981";

  const [name, setName] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("gruppspel");
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduledAt());
  const [openRegistration, setOpenRegistration] = useState(false);
  const [maxTeams, setMaxTeams] = useState<number>(8);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && scheduledLocal.length > 0;

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const scheduledIso = new Date(scheduledLocal).toISOString();
      const tournament = await createDraftTournament({
        tenant_id: tenant.id,
        name: name.trim(),
        format,
        scheduled_at: scheduledIso,
        open_registration: openRegistration,
        max_teams: openRegistration ? maxTeams : null,
      });
      router.push(`/${tenant.slug}/tournament/${tournament.id}/plan`);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-700 px-6 py-5">
        <h1 className="text-2xl font-semibold">Ny session</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{tenant.name}</p>
      </header>

      {err && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {err}
        </div>
      )}

      <main className="p-6 max-w-xl">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          Planera nu — du kan ändra spelare och inställningar fram till att
          sessionen startas.
        </p>

        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium block mb-1">Namn</label>
            <input
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="t.ex. Tisdagsturnering"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Speltyp</label>
            <select
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100"
              value={format}
              onChange={(e) => setFormat(e.target.value as TournamentFormat)}
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} disabled={!o.available}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">
              Datum & tid
            </label>
            <input
              type="datetime-local"
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
            />
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Öppna för bokning</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Spelare kan anmäla sig via en bokningslänk
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={openRegistration}
                onClick={() => setOpenRegistration((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  openRegistration ? "" : "bg-zinc-300"
                }`}
                style={openRegistration ? { backgroundColor: accent } : undefined}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                    openRegistration ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {openRegistration && (
              <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <label className="text-sm font-medium block mb-1">
                  Max antal lag
                </label>
                <input
                  type="number"
                  min={2}
                  max={64}
                  className="w-32 px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100 text-sm"
                  value={maxTeams}
                  onChange={(e) =>
                    setMaxTeams(Math.max(2, parseInt(e.target.value) || 2))
                  }
                />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-3">
            <button
              onClick={submit}
              disabled={!canSubmit || submitting}
              className="px-5 py-2 rounded-md text-white text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: accent }}
            >
              {submitting ? "Skapar..." : "Skapa & planera →"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
