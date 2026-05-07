import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Subdomain routing + auth session refresh + route gating.
//
// Subdomain rewrite: bonpadel.triadsolutions.se/players → /bonpadel/players.
// Apex (and reserved subdomains www/admin) fall through unchanged.
//
// Auth: refreshes the Supabase session cookie on every request, then for
// host-area routes redirects unauthenticated users to /login on the same
// subdomain. Public routes (TV display, customer /play, /login itself,
// /auth/callback) are unrestricted.

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "triadsolutions.se";

function extractTenant(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();

  // Subdomains that are NOT tenants — they fall through to apex (landing page).
  // `smashboard` is the public marketing host (smashboard.triadsolutions.se).
  // `admin` is the super-admin console host. `www` is the canonical apex alias.
  const RESERVED = new Set(["www", "admin", "smashboard"]);

  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    return sub && !RESERVED.has(sub) ? sub : null;
  }

  if (hostname === APP_DOMAIN || hostname === `www.${APP_DOMAIN}`) return null;

  if (hostname.endsWith(`.${APP_DOMAIN}`)) {
    const sub = hostname.slice(0, -(`.${APP_DOMAIN}`.length));
    if (!sub || RESERVED.has(sub)) return null;
    return sub;
  }

  return null;
}

// Paths within a tenant subdomain that DO NOT require authentication.
// Everything else under a tenant requires login.
function isPublicTenantPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/auth/callback") return true;
  if (pathname === "/auth/signout") return true;
  // /play and /{tenant}/play — the latter occurs when links include the tenant
  // slug on subdomains (browser sends /bonpadel/play/... to the middleware).
  if (pathname.startsWith("/play") || /^\/[^/]+\/play(\/|$)/.test(pathname)) return true;
  // /tournament/[id]/play — the QR-code "score your match" page (no login required).
  // Matches both /tournament/<id>/play and /<slug>/tournament/<id>/play.
  if (/\/tournament\/[^/]+\/play(\/|$)/.test(pathname)) return true;
  // /[tenant]/tournament/[id]/display is public — but in middleware we
  // operate on the un-rewritten path (already relative to tenant root)
  if (/^\/tournament\/[^/]+\/display\/?$/.test(pathname)) return true;
  return false;
}

// Paths that live at the app root (not nested under /[tenant]/...) and
// should NOT be rewritten with a tenant prefix even when on a subdomain.
function isRootRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/auth/")
  );
}

export async function middleware(req: NextRequest) {
  const tenant = extractTenant(req.headers.get("host"));
  const pathname = req.nextUrl.pathname;

  // Build the response we'll return; @supabase/ssr writes refreshed
  // session cookies onto it.
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value);
          }
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Use getSession() for route gating — reads JWT from cookies without a
  // network round-trip. getUser() (network-validated) is still called in
  // requireTenantAccess / requireSuperAdmin inside the actual page components.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // Apex / reserved subdomain — only gate /admin
  if (!tenant) {
    if (pathname.startsWith("/admin") && !user) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return res;
  }

  // Tenant subdomain: gate non-public paths
  if (!isPublicTenantPath(pathname) && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Routes that live at the app root (login, auth callback/signout) must
  // NOT be rewritten with a tenant prefix — they exist at /login, /auth/*.
  if (isRootRoute(pathname)) return res;

  // Rewrite to /[tenant]/... so App Router resolves under the dynamic segment
  if (pathname.startsWith(`/${tenant}/`) || pathname === `/${tenant}`) {
    return res;
  }
  const rewritten = req.nextUrl.clone();
  rewritten.pathname = `/${tenant}${pathname}`;

  // Need to apply the rewrite while preserving cookie writes from getUser.
  const rewriteRes = NextResponse.rewrite(rewritten, { request: req });
  res.cookies.getAll().forEach((c) => {
    rewriteRes.cookies.set(c);
  });
  return rewriteRes;
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|.*\\..*).*)"],
};
