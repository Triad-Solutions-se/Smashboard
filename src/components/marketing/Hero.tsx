import { Button } from "./Button";
import { Container } from "./Container";
import { TVImageMockup } from "./TVMockup";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-slate-950 pt-32 pb-20 text-white md:pt-40 md:pb-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 80% 0%, rgba(16,185,129,0.25), transparent 60%), radial-gradient(ellipse 50% 50% at 10% 100%, rgba(159,200,67,0.18), transparent 60%)",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
        aria-hidden
      />

      <Container className="relative">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              För padelhallar
            </span>

            <h1 className="mt-6 text-5xl font-bold leading-[0.95] tracking-tight text-white md:text-7xl">
              Storskärmen som dina{" "}
              <span className="text-[#9fc843]">spelare</span> stannar för.
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-300 md:text-xl">
              Smashboard förvandlar din laptop och TV till en
              live-turneringscentral. Mexicano, Americano och Lag-Mexicano —
              utan kalkylark, utan kaos.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button variant="primaryDark" href="#kontakt">
                Boka demo
                <span aria-hidden>→</span>
              </Button>
              <Button variant="secondaryDark" href="#tv-display">
                Se den live
              </Button>
            </div>

            <p className="mt-6 text-xs text-zinc-500">
              Fungerar med valfri TV via HDMI. Ingen app att installera.
            </p>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <TVImageMockup size="md" />
          </div>
        </div>
      </Container>
    </section>
  );
}
