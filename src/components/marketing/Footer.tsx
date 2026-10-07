import Image from "next/image";
import { Container } from "./Container";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-zinc-50 py-14 text-zinc-700">
      <Container>
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="rounded-md bg-slate-950 p-3 inline-block">
              <Image
                src="/icons/logo.svg"
                alt="Smashboard"
                width={140}
                height={42}
              />
            </div>
            <p className="mt-4 max-w-xs text-sm text-zinc-600">
              Turneringssystem för padelhallar. En produkt från MCA
              Solutions.
            </p>
          </div>

          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Produkten
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href="#funktioner" className="hover:text-emerald-700">
                  Funktioner
                </a>
              </li>
              <li>
                <a href="#tv-display" className="hover:text-emerald-700">
                  TV-display
                </a>
              </li>
              <li>
                <a href="#format" className="hover:text-emerald-700">
                  Format
                </a>
              </li>
              <li>
                <a href="#priser" className="hover:text-emerald-700">
                  Priser
                </a>
              </li>
              <li>
                <a href="#vanliga-fragor" className="hover:text-emerald-700">
                  Vanliga frågor
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Kontakt
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href="mailto:kontakt@mcasolutions.se"
                  className="hover:text-emerald-700"
                >
                  kontakt@mcasolutions.se
                </a>
              </li>
              <li>
                <a href="#kontakt" className="hover:text-emerald-700">
                  Boka demo
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-zinc-200 pt-6 text-xs text-zinc-500 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} MCA Solutions AB. Alla rättigheter förbehållna.</p>
          <p className="font-mono uppercase tracking-[0.2em]">
            Made in Sweden
          </p>
        </div>
      </Container>
    </footer>
  );
}
