"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DarkModeToggle } from "@/components/DarkModeToggle";

type Props = {
  slug: string;
  name: string;
  primaryColor: string | null;
  logoUrl: string | null;
  logoUrlDark: string | null;
};

export function TenantNav({ slug, name, primaryColor, logoUrl, logoUrlDark }: Props) {
  const pathname = usePathname();
  if (pathname?.includes("/tournament/") && (pathname.endsWith("/display") || pathname.endsWith("/play"))) {
    return null;
  }
  if (
    pathname === `/${slug}/play` ||
    pathname?.startsWith(`/${slug}/play/`) ||
    pathname === "/play" ||
    pathname?.startsWith("/play/")
  ) {
    return null;
  }
  const accent = primaryColor || "#10b981";
  const base = `/${slug}`;
  type NavItem = {
    href: string;
    label: string;
    icon?: React.ReactNode;
    iconOnly?: boolean;
  };
  const settingsIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.34 1.68a6.974 6.974 0 0 1 1.706.99l1.612-.612a1 1 0 0 1 1.196.44l.68 1.18a1 1 0 0 1-.22 1.234l-1.272 1.13a7.041 7.041 0 0 1 0 1.972l1.272 1.13a1 1 0 0 1 .22 1.234l-.68 1.18a1 1 0 0 1-1.196.44l-1.612-.612a6.974 6.974 0 0 1-1.706.99l-.34 1.68a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.34-1.68a6.974 6.974 0 0 1-1.706-.99l-1.612.612a1 1 0 0 1-1.196-.44l-.68-1.18a1 1 0 0 1 .22-1.234l1.272-1.13a7.041 7.041 0 0 1 0-1.972l-1.272-1.13a1 1 0 0 1-.22-1.234l.68-1.18a1 1 0 0 1 1.196-.44l1.612.612a6.974 6.974 0 0 1 1.706-.99l.34-1.68ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        clipRule="evenodd"
      />
    </svg>
  );
  const items: NavItem[] = [
    { href: base, label: "Sessioner" },
    { href: `${base}/players`, label: "Spelare" },
    { href: `${base}/settings`, label: "Inställningar", icon: settingsIcon, iconOnly: true },
  ];

  function isActive(href: string) {
    return href === base ? pathname === base : pathname?.startsWith(href);
  }

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 sticky top-0 z-30">
      {/* Main row */}
      <div className="px-4 py-3 flex items-center gap-3 relative">
        <Link href={base} className="flex items-center gap-2 shrink-0">
          {logoUrl || logoUrlDark ? (
            <>
              {/* Light-mode logo: visible in light, hidden in dark (fall back to dark logo if no light) */}
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  className={`h-7 w-auto ${logoUrlDark ? "dark:hidden" : ""}`}
                />
              )}
              {/* Dark-mode logo: hidden in light, visible in dark (fall back to light logo if no dark) */}
              {logoUrlDark && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrlDark}
                  alt=""
                  className={`h-7 w-auto ${logoUrl ? "hidden dark:block" : ""}`}
                />
              )}
            </>
          ) : (
            <>
              <span
                className="inline-flex items-center justify-center h-7 w-7 rounded-md font-black text-sm shrink-0"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                {name.charAt(0)}
              </span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate hidden sm:block">
                {name}
              </span>
            </>
          )}
        </Link>

        {/* Desktop nav items — inline */}
        <nav className="hidden md:flex items-center gap-1 text-sm ml-1">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-label={it.iconOnly ? it.label : undefined}
              title={it.iconOnly ? it.label : undefined}
              className={`${it.iconOnly ? "h-8 w-8 inline-flex items-center justify-center" : "px-3 py-1.5"} rounded-md font-medium transition-colors ${
                isActive(it.href)
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {it.iconOnly && it.icon ? it.icon : it.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Triad logo — centered, always visible */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/triad-logo.png"
            alt="Triad Solutions"
            className="h-7 w-auto"
          />
        </div>

        <Link
          href={`${base}/tournament/new`}
          className="px-3 py-1.5 rounded-md text-white text-sm font-semibold shadow-sm whitespace-nowrap"
          style={{ backgroundColor: accent }}
        >
          + Ny session
        </Link>

        <DarkModeToggle />

        <form action="/auth/signout" method="post" className="hidden sm:block">
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Logga ut
          </button>
        </form>
      </div>

      {/* Mobile nav tabs */}
      <nav className="md:hidden border-t border-zinc-100 dark:border-zinc-800 flex overflow-x-auto text-sm">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-label={it.iconOnly ? it.label : undefined}
            title={it.iconOnly ? it.label : undefined}
            className={`${it.iconOnly ? "px-3 flex items-center" : "px-4"} py-2 font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              isActive(it.href)
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
            style={isActive(it.href) ? { borderColor: accent } : undefined}
          >
            {it.iconOnly && it.icon ? it.icon : it.label}
          </Link>
        ))}
        <form action="/auth/signout" method="post" className="ml-auto shrink-0">
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-zinc-500 dark:text-zinc-400 border-b-2 border-transparent whitespace-nowrap"
          >
            Logga ut
          </button>
        </form>
      </nav>
    </header>
  );
}
