import { Container } from "./Container";
import { Section } from "./Section";

const items = [
  {
    q: "Vad kostar Smashboard?",
    a: "Smashboard kostar från 499 kr/månad för en mindre hall och 999 kr/månad för en hall med obegränsat antal banor. För padelkedjor med flera anläggningar tar vi fram ett anpassat avtal. Alla priser är exklusive moms och utan bindningstid.",
  },
  {
    q: "Är det någon startavgift eller installationskostnad?",
    a: "Nej. Onboarding, white-label-uppsättning (logga, färg, subdomän) och första turneringen ingår i månadspriset. Du betalar bara den löpande månadskostnaden.",
  },
  {
    q: "Hur många banor kan ni hantera?",
    a: "Smashboard skalar från 2 till 12+ banor i samma turnering. Display-vyn anpassar sig automatiskt så att alla banor får plats på TV:n utan att texten blir oläslig.",
  },
  {
    q: "Vilken hårdvara behövs?",
    a: "En vanlig laptop med modern webbläsare och en TV med HDMI-ingång. Inga särskilda installationer, inga drivrutiner, ingen app att ladda ner.",
  },
  {
    q: "Var lagras spelardata?",
    a: "All data ligger inom EU (Supabase, Frankfurt). Vi tar GDPR på största allvar — du äger spelardata och kan exportera eller radera när som helst.",
  },
  {
    q: "Är det någon bindningstid?",
    a: "Nej. Vi tror att produkten ska sälja sig själv. Säg upp när du vill — utan motfrågor.",
  },
  {
    q: "Kan vi använda vår egen logga och färg?",
    a: "Ja. White-label är inkluderat från start. Hallen får en egen subdomän, ni laddar upp er logga och väljer accentfärg. Smashboard syns aldrig på storskärmen.",
  },
];

export function FAQ() {
  return (
    <Section id="vanliga-fragor" tone="light">
      <Container>
        <div className="grid gap-12 md:grid-cols-[1fr_2fr]">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
              FAQ
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">
              Vanliga frågor.
            </h2>
            <p className="mt-4 text-zinc-600">
              Hittar du inte svaret? Skicka ett mail till{" "}
              <a
                href="mailto:kontakt@mcasolutions.se"
                className="font-medium text-emerald-700 underline-offset-4 hover:underline"
              >
                kontakt@mcasolutions.se
              </a>{" "}
              så svarar vi inom dagen.
            </p>
          </div>

          <div className="divide-y divide-zinc-200 border-y border-zinc-200">
            {items.map((item) => (
              <details
                key={item.q}
                className="group relative py-5 [&_svg]:transition-transform open:[&_svg]:rotate-45"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-semibold text-zinc-900">
                  {item.q}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    className="flex-shrink-0 text-zinc-400 group-hover:text-emerald-600"
                    aria-hidden
                  >
                    <path
                      d="M9 3v12M3 9h12"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </summary>
                <p className="mt-3 max-w-prose pr-8 text-base leading-relaxed text-zinc-600">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
