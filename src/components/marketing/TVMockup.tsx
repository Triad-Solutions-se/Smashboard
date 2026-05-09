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

const tvCourts = [
  { label: "B1", teamA: { name: "Andersson / Lind", score: 5 }, teamB: { name: "Berg / Holm", score: 3 }, live: true },
  { label: "B2", teamA: { name: "Ek / Sjöberg", score: 4 }, teamB: { name: "Norén / Vik", score: 4 }, live: false },
  { label: "B3", teamA: { name: "Wahl / Ros", score: 6 }, teamB: { name: "Lund / Falk", score: 2 }, live: false },
  { label: "B4", teamA: { name: "Karlsson / Ek", score: 1 }, teamB: { name: "Ström / Berg", score: 5 }, live: false },
  { label: "B5", teamA: { name: "Holm / Sjö", score: 3 }, teamB: { name: "Wik / Lind", score: 6 }, live: false },
  { label: "B6", teamA: { name: "Björk / Falk", score: 5 }, teamB: { name: "Ros / Eng", score: 5 }, live: false },
  { label: "B7", teamA: { name: "Hult / Ahl", score: 7 }, teamB: { name: "Berg / Vik", score: 1 }, live: false },
  { label: "B8", teamA: { name: "Lund / Eng", score: 2 }, teamB: { name: "Norén / Holm", score: 6 }, live: false },
];

const tvLeaderboard = [
  { rank: 1, name: "Wahl", points: 32 },
  { rank: 2, name: "Andersson", points: 30 },
  { rank: 3, name: "Sjöberg", points: 28 },
  { rank: 4, name: "Berg", points: 26 },
  { rank: 5, name: "Lind", points: 25 },
  { rank: 6, name: "Holm", points: 23 },
  { rank: 7, name: "Ek", points: 22 },
  { rank: 8, name: "Norén", points: 20 },
  { rank: 9, name: "Vik", points: 19 },
  { rank: 10, name: "Karlsson", points: 17 },
  { rank: 11, name: "Falk", points: 15 },
  { rank: 12, name: "Ström", points: 13 },
];

function TinyCourtCard({
  data,
  liveScore,
}: {
  data: (typeof tvCourts)[number];
  liveScore?: number;
}) {
  const aScore = data.live && liveScore !== undefined ? liveScore : data.teamA.score;
  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-[3px] ring-1 ring-white/10">
      <MiniCourt />
      <div className="relative flex items-center justify-between px-1 pt-0.5">
        <span className="font-mono text-[5px] font-semibold uppercase tracking-[0.12em] text-white/85 sm:text-[6px]">
          {data.label}
        </span>
        {data.live && (
          <span className="flex items-center gap-[1px] rounded-full bg-rose-500/90 px-0.5 py-[0.5px] text-[4px] font-bold uppercase tracking-wider text-white sm:text-[5px]">
            <span className="h-[2px] w-[2px] animate-pulse rounded-full bg-white" />
            Live
          </span>
        )}
      </div>
      <div className="relative mt-auto space-y-[2px] px-1 pb-1">
        <div className="flex items-center justify-between gap-1 rounded-[2px] bg-black/40 px-1 py-px backdrop-blur-sm">
          <span className="truncate text-[5px] font-medium text-white sm:text-[6px]">
            {data.teamA.name}
          </span>
          <span className="font-mono text-[7px] font-bold tabular-nums text-white sm:text-[8px]">
            {aScore}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 rounded-[2px] bg-black/40 px-1 py-px backdrop-blur-sm">
          <span className="truncate text-[5px] font-medium text-white sm:text-[6px]">
            {data.teamB.name}
          </span>
          <span className="font-mono text-[7px] font-bold tabular-nums text-white sm:text-[8px]">
            {data.teamB.score}
          </span>
        </div>
      </div>
    </div>
  );
}

function ScreenContent({ liveScore }: { liveScore: number }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/5 px-2 py-[3px] sm:px-2.5 sm:py-1">
        <div className="flex items-center gap-1">
          <div className="h-1 w-1 animate-pulse rounded-full bg-rose-500" />
          <span className="font-mono text-[6px] font-bold uppercase tracking-[0.18em] text-white/85 sm:text-[7px]">
            Bonpadel · Mexicano
          </span>
        </div>
        <span className="font-mono text-[6px] font-semibold uppercase tracking-[0.18em] text-white/60 sm:text-[7px]">
          Runda 3 / 5
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-1 p-1 sm:gap-1.5 sm:p-1.5">
        <div className="col-span-3 grid min-h-0 grid-cols-4 grid-rows-2 gap-1 sm:gap-1.5">
          {tvCourts.map((c, i) => (
            <TinyCourtCard
              key={c.label}
              data={c}
              liveScore={i === 0 ? liveScore : undefined}
            />
          ))}
        </div>

        <div className="flex min-h-0 flex-col rounded-[4px] bg-white/5 p-1 ring-1 ring-white/10 sm:p-1.5">
          <div className="mb-0.5 flex items-center justify-between sm:mb-1">
            <span className="font-mono text-[5px] font-bold uppercase tracking-[0.18em] text-[#9fc843] sm:text-[6px]">
              Topplista
            </span>
            <span className="font-mono text-[5px] uppercase tracking-wider text-white/40 sm:text-[6px]">
              Poäng
            </span>
          </div>
          <ul className="flex flex-1 flex-col justify-between">
            {tvLeaderboard.map((row) => (
              <li
                key={row.name}
                className="flex items-center justify-between px-0.5 text-[6px] leading-tight text-white sm:text-[7px]"
              >
                <span className="flex items-center gap-1">
                  <span
                    className={`flex h-2 w-2 items-center justify-center rounded-full font-mono text-[4px] font-bold sm:h-2.5 sm:w-2.5 sm:text-[5px] ${
                      row.rank === 1
                        ? "bg-[#9fc843] text-slate-950"
                        : "bg-white/10 text-white/80"
                    }`}
                  >
                    {row.rank}
                  </span>
                  <span className="truncate font-medium">{row.name}</span>
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
  );
}

export function TVImageMockup({ size = "md" }: { size?: "md" | "lg" }) {
  const [liveScore, setLiveScore] = useState(tvCourts[0].teamA.score);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setLiveScore((s) => (s >= 7 ? tvCourts[0].teamA.score : s + 1));
    }, 2400);
    return () => window.clearInterval(id);
  }, []);

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
          className="absolute overflow-hidden bg-slate-950"
          style={{
            left: "2.99%",
            right: "2.91%",
            top: "4.46%",
            bottom: "16.02%",
          }}
        >
          <ScreenContent liveScore={liveScore} />
        </div>
      </div>
    </div>
  );
}
