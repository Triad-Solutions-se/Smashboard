# Smashboard

White-label padel tournament management platform. Each padel venue gets a custom subdomain (e.g. bonpadel.triadsolutions.se). Hosts run the app on a laptop and cast it to a TV via HDMI.

## Tech Stack
- Next.js 15 App Router
- Supabase (Postgres + Auth + Realtime)
- Tailwind CSS
- Vercel hosting

## Architecture
- Multi-tenant via subdomain routing (Next.js middleware reads host header → resolves tenant slug)
- TV display is the primary output — large text, SVG court illustrations, Supabase realtime auto-refresh
- Host view for score entry and round advancement
- Super admin at /admin for Triad Solutions to provision tenants

## Tournament Formats
- Mexicano: dynamic partners, sorted by cumulative points each round
- Americano: fixed individual scoring, full round-robin partner rotation
- Team Mexicano: fixed pairs, court assignments rotate by performance

## Key Routes
- /[tenant]/tournament/[id]/display — TV display (realtime, read-only)
- /[tenant]/tournament/[id]/host — host score entry
- /[tenant]/tournament/new — tournament setup wizard
- /[tenant]/players — player roster management
- /[tenant]/settings — venue branding & courts
- /admin — super admin (Triad Solutions internal)

## Supabase Tables
tenants, courts, players, tournaments, tournament_players, tournament_courts, rounds, matches

## Commands
- npm run dev — start dev server
- npm run build — production build
- npm run lint — lint check

## Project journal
This project is tracked in an Obsidian vault note at:
`~/Documents/Triad Solutions/ProjectVault/01 Projects/Smashboard/Smashboard.md`

- **Start of every session:** read the vault note for goal, next action, and log.
- **After significant work** (feature done, decision made, blocker hit): append a
  dated entry under `## 🗒️ Log` — 1-3 bullets on what was done and why.
- **Keep frontmatter current:** update `next-action` to the single most important
  next step, and `status` (active / on-hold / done) if it changed.
- **Never rewrite or delete existing log entries** — only append.
- **Don't log trivial changes** (typos, formatting).
