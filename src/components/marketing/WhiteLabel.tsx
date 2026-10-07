"use client";

import { useEffect, useState } from "react";
import { Container } from "./Container";
import { Section } from "./Section";

const themes = [
  {
    name: "Bonpadel",
    accent: "#9fc843",
    accentDark: "#0d9469",
    bg: "linear-gradient(135deg, #052e16 0%, #064e3b 100%)",
    initials: "BP",
  },
  {
    name: "Stadshallen",
    accent: "#fb923c",
    accentDark: "#c2410c",
    bg: "linear-gradient(135deg, #1c1917 0%, #292524 100%)",
    initials: "SH",
  },
  {
    name: "Padel Norr",
    accent: "#60a5fa",
    accentDark: "#1d4ed8",
    bg: "linear-gradient(135deg, #0c1321 0%, #1e293b 100%)",
    initials: "PN",
  },
];

export function WhiteLabel() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % themes.length);
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  const theme = themes[idx];

  return (
    <Section tone="light">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div className="max-w-xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
              White-label
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 md:text-5xl">
              Din logga. Din färg. <br />
              Ditt varumärke.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              Smashboard syns aldrig för dina gäster. Hallen får en egen
              subdomän — t.ex.{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm text-zinc-800">
                hallen.mcasolutions.se
              </code>{" "}
              — med er logga, era färger och er identitet på storskärmen.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                "Egen subdomän inkluderad",
                "Logga och accentfärg från era riktlinjer",
                "Inga MCA- eller Smashboard-loggor i display-vyn",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      aria-hidden
                    >
                      <path
                        d="M2.5 6.5l2.5 2.5 4.5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="text-zinc-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div
              className="overflow-hidden rounded-3xl p-8 shadow-2xl ring-1 ring-white/10 transition-all duration-700 ease-out"
              style={{ background: theme.bg }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl font-mono text-lg font-extrabold text-slate-950 transition-colors duration-700"
                    style={{ backgroundColor: theme.accent }}
                  >
                    {theme.initials}
                  </div>
                  <div className="leading-tight">
                    <p
                      className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors duration-700"
                      style={{ color: theme.accent }}
                    >
                      Padelhall
                    </p>
                    <p className="text-xl font-bold text-white">
                      {theme.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/70">
                    Live
                  </span>
                </div>
              </div>

              <div className="mt-8 rounded-2xl bg-black/30 p-5 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                    Bana 1
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider transition-colors duration-700"
                    style={{
                      backgroundColor: theme.accent,
                      color: "#0a0a0a",
                    }}
                  >
                    Final
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-white/70">Andersson / Lind</p>
                    <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">
                      6
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-white/70">Berg / Holm</p>
                    <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">
                      4
                    </p>
                  </div>
                </div>
                <div
                  className="mt-4 h-1 overflow-hidden rounded-full bg-white/10"
                  aria-hidden
                >
                  <div
                    className="h-full transition-colors duration-700"
                    style={{
                      width: "60%",
                      backgroundColor: theme.accent,
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-center gap-1.5">
                {themes.map((t, i) => (
                  <span
                    key={t.name}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i === idx ? "w-6 bg-white/80" : "w-1.5 bg-white/30"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
