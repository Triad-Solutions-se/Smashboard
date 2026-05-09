"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const courts = [
  {
    label: "Bana 1",
    teamA: { name: "Andersson / Lind", score: 5 },
    teamB: { name: "Berg / Holm", score: 3 },
    live: true,
  },
  {
    label: "Bana 2",
    teamA: { name: "Ek / Sjöberg", score: 4 },
    teamB: { name: "Norén / Vik", score: 4 },
    live: false,
  },
  {
    label: "Bana 3",
    teamA: { name: "Wahl / Ros", score: 6 },
    teamB: { name: "Lund / Falk", score: 2 },
    live: false,
  },
  {
    label: "Bana 4",
    teamA: { name: "Karlsson / Ek", score: 1 },
    teamB: { name: "Ström / Berg", score: 5 },
    live: false,
  },
];

const leaderboard = [
  { rank: 1, name: "Wahl", points: 18 },
  { rank: 2, name: "Andersson", points: 16 },
  { rank: 3, name: "Sjöberg", points: 14 },
  { rank: 4, name: "Berg", points: 13 },
  { rank: 5, name: "Lind", points: 12 },
];

function MiniCourt() {
  return (
    <svg
      viewBox="0 0 200 120"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="court-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d9469" />
          <stop offset="100%" stopColor="#0a7a57" />
        </linearGradient>
      </defs>
      <rect width="200" height="120" fill="url(#court-grad)" rx="6" />
      <rect
        x="6"
        y="6"
        width="188"
        height="108"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1"
        rx="4"
      />
      <line
        x1="100"
        y1="6"
        x2="100"
        y2="114"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.2"
      />
      <line
        x1="40"
        y1="6"
        x2="40"
        y2="114"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.8"
      />
      <line
        x1="160"
        y1="6"
        x2="160"
        y2="114"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.8"
      />
      <line
        x1="40"
        y1="60"
        x2="160"
        y2="60"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.8"
      />
      <rect
        x="0"
        y="0"
        width="3"
        height="120"
        fill="#7dd3fc"
        opacity="0.6"
      />
      <rect
        x="197"
        y="0"
        width="3"
        height="120"
        fill="#7dd3fc"
        opacity="0.6"
      />
    </svg>
  );
}

function CourtCard({
  data,
  liveScore,
}: {
  data: (typeof courts)[number];
  liveScore?: number;
}) {
  const aScore = data.live && liveScore !== undefined ? liveScore : data.teamA.score;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl ring-1 ring-white/10">
      <MiniCourt />
      <div className="relative flex items-center justify-between px-3 pt-2.5">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-white/80">
          {data.label}
        </span>
        {data.live && (
          <span className="flex items-center gap-1 rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
            <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
            Live
          </span>
        )}
      </div>
      <div className="relative mt-auto space-y-1 px-3 pb-3">
        <div className="flex items-center justify-between gap-2 rounded-md bg-black/30 px-2 py-1 backdrop-blur-sm">
          <span className="truncate text-[10px] font-medium text-white">
            {data.teamA.name}
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-white">
            {aScore}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md bg-black/30 px-2 py-1 backdrop-blur-sm">
          <span className="truncate text-[10px] font-medium text-white">
            {data.teamB.name}
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-white">
            {data.teamB.score}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TVMockup({ size = "md" }: { size?: "md" | "lg" }) {
  const [liveScore, setLiveScore] = useState(courts[0].teamA.score);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setLiveScore((s) => (s >= 7 ? courts[0].teamA.score : s + 1));
    }, 2400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className={`relative ${
        size === "lg" ? "max-w-5xl" : "max-w-2xl"
      } w-full`}
    >
      <div className="rounded-[24px] bg-gradient-to-b from-zinc-800 to-zinc-950 p-2 shadow-2xl ring-1 ring-white/10">
        <div className="overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-inset ring-white/5">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
                Bonpadel · Mexicano
              </span>
            </div>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
              Runda 3 / 5
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              {courts.map((c, i) => (
                <CourtCard
                  key={c.label}
                  data={c}
                  liveScore={i === 0 ? liveScore : undefined}
                />
              ))}
            </div>

            <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#9fc843]">
                  Topplista
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-white/40">
                  Poäng
                </span>
              </div>
              <ul className="space-y-1.5">
                {leaderboard.map((row) => (
                  <li
                    key={row.name}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-white"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px] font-bold ${
                          row.rank === 1
                            ? "bg-[#9fc843] text-slate-950"
                            : "bg-white/10 text-white/80"
                        }`}
                      >
                        {row.rank}
                      </span>
                      <span className="font-medium">{row.name}</span>
                    </span>
                    <span className="font-mono font-bold tabular-nums">
                      {row.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -right-3 -bottom-6 hidden rounded-xl bg-zinc-900 p-2 shadow-xl ring-1 ring-white/10 sm:block">
        <div className="flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5">
          <svg width="16" height="12" viewBox="0 0 24 18" aria-hidden>
            <rect
              x="0.5"
              y="0.5"
              width="23"
              height="17"
              rx="2"
              fill="#1f2937"
              stroke="#9fc843"
              strokeWidth="1"
            />
            <rect x="3" y="3" width="18" height="12" rx="1" fill="#0d9469" />
          </svg>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-white/70">
            HDMI · Laptop
          </span>
        </div>
      </div>
    </div>
  );
}

const TV_ACCENT = "#9fc843";

type TVCourt = {
  id: string;
  name: string;
  group: 0 | 1;
  live: boolean;
  team1: [string, string];
  team2: [string, string];
  next: string;
};

const tvCourts: TVCourt[] = [
  {
    id: "c1",
    name: "Bana 1",
    group: 0,
    live: true,
    team1: ["Andersson", "Lind"],
    team2: ["Berg", "Holm"],
    next: "Wahl/Ros vs Lund/Falk",
  },
  {
    id: "c2",
    name: "Bana 2",
    group: 0,
    live: false,
    team1: ["Ek", "Sjöberg"],
    team2: ["Norén", "Vik"],
    next: "Holm/Sjö vs Wik/Lind",
  },
  {
    id: "c3",
    name: "Bana 3",
    group: 1,
    live: false,
    team1: ["Wahl", "Ros"],
    team2: ["Lund", "Falk"],
    next: "Karlsson/Ek vs Ström/Berg",
  },
  {
    id: "c4",
    name: "Bana 4",
    group: 1,
    live: false,
    team1: ["Karlsson", "Ek"],
    team2: ["Ström", "Berg"],
    next: "Björk/Falk vs Ros/Eng",
  },
];

const tvStandings = [
  {
    name: "Grupp A",
    barClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
    rows: [
      { name: "Wahl/Ros", gd: 8 },
      { name: "Andersson/Lind", gd: 4 },
      { name: "Ek/Sjöberg", gd: -2 },
      { name: "Berg/Holm", gd: -10 },
    ],
  },
  {
    name: "Grupp B",
    barClass: "bg-sky-50 text-sky-800 border-sky-200",
    rows: [
      { name: "Hult/Ahl", gd: 6 },
      { name: "Norén/Vik", gd: 3 },
      { name: "Karlsson/Ström", gd: -1 },
      { name: "Lund/Falk", gd: -8 },
    ],
  },
];

function MockHeader() {
  return (
    <header
      className="grid shrink-0 grid-cols-3 items-center gap-2 border-b border-zinc-200 px-[2cqw]"
      style={{ height: "13cqh" }}
    >
      <div className="min-w-0">
        <div
          className="truncate font-black leading-none tracking-tight text-zinc-900"
          style={{ fontSize: "3.4cqw" }}
        >
          Bonpadel Open
        </div>
        <div
          className="mt-[0.4cqh] flex items-center gap-[0.6cqw] truncate text-zinc-500"
          style={{ fontSize: "1.4cqw" }}
        >
          <span className="font-semibold text-zinc-700">Bonpadel</span>
          <span
            className="inline-block w-px bg-zinc-300"
            style={{ height: "0.9em" }}
            aria-hidden
          />
          <span className="text-zinc-600">Mexicano</span>
          <span
            className="inline-block w-px bg-zinc-300"
            style={{ height: "0.9em" }}
            aria-hidden
          />
          <span className="tabular-nums">Mål 7 game</span>
        </div>
      </div>
      <div className="flex h-full items-center justify-center gap-[1.5cqw]">
        <div
          className="flex aspect-square items-center justify-center rounded-[0.8cqw] font-black"
          style={{
            height: "10cqh",
            backgroundColor: `${TV_ACCENT}22`,
            color: TV_ACCENT,
            fontSize: "5cqw",
          }}
        >
          B
        </div>
        <span
          className="font-black leading-none text-zinc-900"
          style={{ fontSize: "4.5cqw" }}
        >
          ×
        </span>
        <span
          className="font-black tracking-tight text-zinc-900"
          style={{ fontSize: "2.4cqw" }}
        >
          triad
        </span>
      </div>
      <div className="flex items-center justify-end gap-[1.4cqw]">
        <div
          className="text-right leading-tight text-zinc-500"
          style={{ fontSize: "1.2cqw" }}
        >
          <p className="font-semibold text-zinc-700">Rapportera</p>
          <p>Skanna &amp; välj lag</p>
        </div>
        <div
          className="grid grid-cols-5 grid-rows-5 gap-[0.15cqw] rounded-[0.5cqw] bg-white p-[0.4cqw] ring-1 ring-zinc-200"
          style={{ width: "9.5cqh", height: "9.5cqh" }}
          aria-hidden
        >
          {[
            1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1,
            1, 1,
          ].map((on, i) => (
            <div
              key={i}
              className={on ? "bg-zinc-900" : "bg-transparent"}
              style={{ borderRadius: "0.05cqw" }}
            />
          ))}
        </div>
        <div className="flex flex-col items-end gap-[0.3cqh]">
          <div className="flex items-center gap-[0.4cqw]">
            <span
              className="inline-block animate-pulse rounded-full"
              style={{
                width: "0.7cqw",
                height: "0.7cqw",
                backgroundColor: TV_ACCENT,
              }}
            />
            <span
              className="font-semibold uppercase tracking-widest text-zinc-700"
              style={{ fontSize: "1.1cqw" }}
            >
              Live · 14:32
            </span>
          </div>
          <div
            className="tabular-nums text-zinc-500"
            style={{ fontSize: "1.1cqw" }}
          >
            12 / 24 matcher
          </div>
        </div>
      </div>
    </header>
  );
}

function MockCourtCard({ court }: { court: TVCourt }) {
  const groupBadgeClass =
    court.group === 0
      ? "bg-emerald-100 text-emerald-700"
      : "bg-sky-100 text-sky-700";
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-[1cqw]"
      style={{
        ...(court.live
          ? {
              boxShadow: `inset 0 0 0 0.25cqw ${TV_ACCENT}, 0 0 3cqw -0.8cqw ${TV_ACCENT}`,
            }
          : {}),
      }}
    >
      <div className="relative flex items-center justify-between gap-[0.6cqw] px-[1.2cqw] pt-[0.7cqh] pb-[0.4cqh]">
        <div className="flex items-center gap-[0.6cqw]">
          <div
            className="rounded-[0.3cqw] px-[0.6cqw] py-[0.05cqh] font-black tracking-tight"
            style={{
              backgroundColor: `${TV_ACCENT}1f`,
              color: TV_ACCENT,
              fontSize: "1.9cqw",
            }}
          >
            {court.name}
          </div>
          {court.live && (
            <span
              className="inline-flex items-center gap-[0.3cqw] rounded-full px-[0.7cqw] py-[0.1cqh] font-black uppercase tracking-widest text-white"
              style={{
                backgroundColor: TV_ACCENT,
                fontSize: "1cqw",
                boxShadow: `0 0 0 0.4cqw ${TV_ACCENT}22`,
              }}
            >
              <span
                className="inline-block animate-pulse rounded-full bg-white"
                style={{ width: "0.5cqw", height: "0.5cqw" }}
              />
              Live
            </span>
          )}
        </div>
        <div
          className={`rounded-[0.3cqw] px-[0.5cqw] py-[0.05cqh] font-bold uppercase tracking-wider ${groupBadgeClass}`}
          style={{ fontSize: "1.1cqw" }}
        >
          Grupp {court.group === 0 ? "A" : "B"}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center px-[0.5cqw] pb-[0.4cqh]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/court-topdown.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-contain object-center"
        />
        <div className="relative grid w-full grid-cols-2 items-center gap-[1cqw] px-[8%]">
          <div className="min-w-0 text-right">
            <div
              className="truncate font-bold leading-tight text-white"
              style={{
                fontSize: "2.3cqw",
                textShadow: "0 0.1cqw 0.3cqw rgba(0,0,0,0.5)",
              }}
            >
              {court.team1[0]}
            </div>
            <div
              className="truncate font-bold leading-tight text-white"
              style={{
                fontSize: "2.3cqw",
                textShadow: "0 0.1cqw 0.3cqw rgba(0,0,0,0.5)",
              }}
            >
              {court.team1[1]}
            </div>
          </div>
          <div className="min-w-0 text-left">
            <div
              className="truncate font-bold leading-tight text-white"
              style={{
                fontSize: "2.3cqw",
                textShadow: "0 0.1cqw 0.3cqw rgba(0,0,0,0.5)",
              }}
            >
              {court.team2[0]}
            </div>
            <div
              className="truncate font-bold leading-tight text-white"
              style={{
                fontSize: "2.3cqw",
                textShadow: "0 0.1cqw 0.3cqw rgba(0,0,0,0.5)",
              }}
            >
              {court.team2[1]}
            </div>
          </div>
        </div>
      </div>
      <div className="relative flex items-center gap-[0.6cqw] border-t border-zinc-200 px-[1cqw] py-[0.4cqh]">
        <span
          className="inline-flex shrink-0 items-center gap-[0.2cqw] rounded-[0.3cqw] px-[0.5cqw] py-[0.05cqh] font-black uppercase tracking-widest"
          style={{
            backgroundColor: `${TV_ACCENT}1a`,
            color: TV_ACCENT,
            fontSize: "0.95cqw",
          }}
        >
          Nästa <span aria-hidden>→</span>
        </span>
        <span
          className="truncate font-semibold text-zinc-700"
          style={{ fontSize: "1.15cqw" }}
        >
          {court.next}
        </span>
      </div>
    </div>
  );
}

function MockStandings() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-[1cqw] border border-zinc-200 bg-white"
      style={{ boxShadow: "0 0.4cqw 1.8cqw -1cqw rgba(0,0,0,0.18)" }}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-[0.8cqw] py-[0.5cqh]"
        style={{ backgroundColor: `${TV_ACCENT}15` }}
      >
        <div
          className="font-black uppercase tracking-[0.1em]"
          style={{ color: TV_ACCENT, fontSize: "1.5cqw" }}
        >
          Tabell
        </div>
        <div
          className="font-semibold uppercase tracking-widest tabular-nums text-zinc-500"
          style={{ fontSize: "1cqw" }}
        >
          # · LAG · GD
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col divide-y divide-zinc-200">
        {tvStandings.map((g) => (
          <div key={g.name} className="flex min-h-fit flex-1 flex-col">
            <div
              className={`flex items-center justify-between px-[0.8cqw] py-[0.3cqh] font-bold tracking-tight ${g.barClass}`}
              style={{ fontSize: "1.4cqw" }}
            >
              <span>{g.name}</span>
              <span
                className="font-semibold tabular-nums opacity-60"
                style={{ fontSize: "1.05cqw" }}
              >
                {g.rows.length}
              </span>
            </div>
            <ul className="flex flex-col">
              {g.rows.map((r, i) => (
                <li
                  key={r.name}
                  className="flex items-center gap-[0.5cqw] border-t border-zinc-100 px-[0.8cqw] py-[0.3cqh]"
                  style={{ fontSize: "1.4cqw" }}
                >
                  <span
                    className="inline-flex shrink-0 items-center justify-center rounded-full font-black tabular-nums"
                    style={{
                      width: "1.5em",
                      height: "1.5em",
                      ...(i === 0
                        ? {
                            backgroundColor: `${TV_ACCENT}25`,
                            color: TV_ACCENT,
                          }
                        : { color: "#a1a1aa" }),
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-zinc-800">
                    {r.name}
                  </span>
                  <span
                    className="shrink-0 font-bold tabular-nums"
                    style={{
                      color:
                        r.gd > 0
                          ? TV_ACCENT
                          : r.gd < 0
                            ? "#dc2626"
                            : "#71717a",
                    }}
                  >
                    {r.gd > 0 ? `+${r.gd}` : r.gd}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockFooter() {
  return (
    <footer className="flex shrink-0 items-center justify-between gap-[1cqw] border-t border-zinc-200 px-[2cqw] py-[0.5cqh]">
      <div
        className="flex min-w-0 items-center gap-[0.6cqw] font-semibold uppercase tracking-widest text-zinc-500"
        style={{ fontSize: "1.05cqw" }}
      >
        <span className="text-zinc-700">Bonpadel</span>
        <span className="text-zinc-300">·</span>
        <span>Pågående</span>
        <span className="text-zinc-300">·</span>
        <span className="tabular-nums">Uppdaterad 14:32</span>
      </div>
      <div
        className="font-semibold uppercase tracking-widest text-zinc-400"
        style={{ fontSize: "1.05cqw" }}
      >
        smashboard
      </div>
    </footer>
  );
}

function ScreenContent() {
  return (
    <div
      className="flex h-full w-full flex-col bg-zinc-50 text-zinc-900"
      style={{ containerType: "size" }}
    >
      <MockHeader />
      <main className="flex min-h-0 flex-1 gap-[1cqw] px-[1.5cqw] py-[0.8cqh]">
        <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-[1cqw]">
          {tvCourts.map((c) => (
            <MockCourtCard key={c.id} court={c} />
          ))}
        </div>
        <aside className="w-[28cqw] shrink-0">
          <MockStandings />
        </aside>
      </main>
      <MockFooter />
    </div>
  );
}

export function TVImageMockup({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div
      className={`relative w-full ${
        size === "lg" ? "max-w-5xl" : "max-w-2xl"
      }`}
    >
      <div
        className="relative"
        style={{ aspectRatio: "1238 / 874" }}
      >
        <Image
          src="/tv.png"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 42rem, 100vw"
          className="pointer-events-none select-none object-contain"
          aria-hidden
        />
        <div
          className="absolute overflow-hidden bg-zinc-50"
          style={{
            left: "2.99%",
            right: "2.91%",
            top: "4.46%",
            bottom: "16.02%",
          }}
        >
          <ScreenContent />
        </div>
      </div>
    </div>
  );
}
