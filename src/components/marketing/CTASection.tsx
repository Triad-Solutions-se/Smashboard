import { Container } from "./Container";

export function CTASection() {
  return (
    <section
      id="kontakt"
      className="relative overflow-hidden bg-slate-950 py-24 text-white md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(159,200,67,0.15), transparent 60%)",
        }}
        aria-hidden
      />

      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[#9fc843]">
            Kom igång
          </p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
            Klar att testa?
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-zinc-300">
            Boka 20 minuter — vi ringer upp, visar Smashboard live och svarar
            på alla frågor. Ingen kod, inget konto, inga åtaganden.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="mailto:kontakt@mcasolutions.se?subject=Demo%20av%20Smashboard"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#9fc843] px-7 py-3.5 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-[#b3da5d]"
            >
              Boka demo
              <span aria-hidden>→</span>
            </a>
            <a
              href="mailto:kontakt@mcasolutions.se"
              className="font-mono text-sm text-zinc-400 transition hover:text-white"
            >
              kontakt@mcasolutions.se
            </a>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-500">
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path
                  d="M3 7l3 3 5-6"
                  stroke="#9fc843"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Egen subdomän
            </span>
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path
                  d="M3 7l3 3 5-6"
                  stroke="#9fc843"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Onboarding ingår
            </span>
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path
                  d="M3 7l3 3 5-6"
                  stroke="#9fc843"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Ingen bindningstid
            </span>
          </div>
        </div>
      </Container>
    </section>
  );
}
