"use client";

import { useState } from "react";

export type PaymentPlayerRow = {
  key: string;
  teamId: string;
  slot: 1 | 2;
  displayName: string;
  paid: boolean;
};

export function PaymentPanel({
  players,
  accent,
  onSetPaid,
}: {
  players: PaymentPlayerRow[];
  accent: string;
  onSetPaid: (teamId: string, slot: 1 | 2, paid: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"unpaid" | "paid">("unpaid");
  const [search, setSearch] = useState("");

  const unpaid = players.filter((p) => !p.paid);
  const paid = players.filter((p) => p.paid);

  async function handle(row: PaymentPlayerRow, paid: boolean) {
    setBusy(row.key);
    try {
      await onSetPaid(row.teamId, row.slot, paid);
    } finally {
      setBusy(null);
    }
  }

  const query = search.trim().toLowerCase();
  const baseList = tab === "unpaid" ? unpaid : paid;
  const list = query
    ? baseList.filter((p) => p.displayName.toLowerCase().includes(query))
    : baseList;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          {paid.length} av {players.length} har betalat
        </span>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Sök spelare…"
        className="w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100 px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
      />

      <div className="flex items-center gap-0 border-b border-zinc-200 dark:border-zinc-700">
        {(
          [
            ["unpaid", `Att betala (${unpaid.length})`],
            ["paid", `Betalda (${paid.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              tab === key
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
            style={tab === key ? { borderColor: accent } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {query
            ? "Inga spelare matchar sökningen"
            : tab === "unpaid"
              ? "Alla har betalat!"
              : "Ingen har betalat ännu"}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((row) => (
            <li
              key={row.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5"
            >
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {row.displayName}
              </span>
              {row.paid ? (
                <button
                  onClick={() => handle(row, false)}
                  disabled={busy === row.key}
                  className="shrink-0 px-3 py-1 rounded text-xs font-semibold text-white disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: accent }}
                >
                  {busy === row.key ? "…" : "Betald ✓"}
                </button>
              ) : (
                <button
                  onClick={() => handle(row, true)}
                  disabled={busy === row.key}
                  className="shrink-0 px-3 py-1 rounded text-xs font-semibold text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                >
                  {busy === row.key ? "…" : "Markera betald"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
