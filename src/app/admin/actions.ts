"use server";

import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/auth/require";
import { getSupabaseAuthServer } from "@/lib/supabase/auth-server";

// Server actions for super-admin tenant provisioning. The "invite owner"
// flow needs auth.admin (service role); the rest go through the user's own
// session (which is super-admin gated).

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED_SLUGS = new Set(["www", "admin", "smashboard"]);

function getServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const LOGO_BUCKET = "tenant-logos";
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function uploadLogo(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireSuperAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Ingen fil" };
  if (!ALLOWED_MIME.has(file.type))
    return { ok: false, error: "Ogiltigt filformat (PNG, JPEG, WebP, SVG, GIF)" };
  if (file.size > MAX_BYTES)
    return { ok: false, error: "Filen är för stor (max 2 MB)" };

  const ext = file.name.split(".").pop() ?? "png";
  const path = `${Date.now()}.${ext}`;

  const admin = getServiceRoleClient();
  const bytes = await file.arrayBuffer();

  const { error } = await admin.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };

  const { data } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

export async function registerCustomer(input: {
  slug: string;
  name: string;
  primary_color: string;
  logo_url?: string | null;
  ownerEmail: string;
}): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  await requireSuperAdmin();

  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const email = input.ownerEmail.trim().toLowerCase();
  const logoUrl = input.logo_url?.trim() || null;

  if (!SLUG_RE.test(slug)) return { ok: false, error: "Subdomän måste vara 2–31 tecken (a–z, 0–9, -)" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: "Reserverad subdomän" };
  if (!name) return { ok: false, error: "Företagsnamn krävs" };
  if (!email.includes("@")) return { ok: false, error: "Ogiltig e-post" };
  if (logoUrl && !/^https?:\/\//i.test(logoUrl))
    return { ok: false, error: "Logo URL måste börja med http(s)://" };

  const admin = getServiceRoleClient();

  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .insert({
      slug,
      name,
      primary_color: input.primary_color,
      logo_url: logoUrl,
    })
    .select("id")
    .single();
  if (tErr || !tenant) return { ok: false, error: tErr?.message ?? "Kunde inte skapa anläggning" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "triadsolutions.se";
  const redirectTo = `https://${slug}.${baseUrl}/auth/callback?next=${encodeURIComponent("/auth/set-password")}`;

  const { data: invite, error: invErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo }
  );

  let userId = invite?.user?.id;

  if (invErr || !userId) {
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = existing?.users?.find((x) => x.email?.toLowerCase() === email);
    if (!u) return { ok: false, error: invErr?.message ?? "Kunde inte skicka inbjudan" };
    userId = u.id;
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkErr) return { ok: false, error: linkErr.message };
  }

  const { error: linkErr } = await admin
    .from("tenant_users")
    .upsert({ tenant_id: tenant.id, user_id: userId, role: "owner" });
  if (linkErr) return { ok: false, error: linkErr.message };

  await addVercelDomain(`${slug}.${baseUrl}`);

  return { ok: true, tenantId: tenant.id };
}

async function addVercelDomain(domain: string): Promise<void> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return; // silently skip if not configured

  await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
  });
}

export async function deleteTenant(input: {
  tenantId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSuperAdmin();
  const admin = getServiceRoleClient();
  const tenantId = input.tenantId;

  // Pull tournament ids first so we can wipe their per-tournament children.
  const { data: tRows, error: tErr } = await admin
    .from("tournaments")
    .select("id")
    .eq("tenant_id", tenantId);
  if (tErr) return { ok: false, error: tErr.message };
  const tournamentIds = (tRows ?? []).map((t) => t.id);

  // Order matters because we don't rely on FK cascade:
  //
  // 1. tournament_registrations (FK to both tenant_id and tournament_id) —
  //    cleared first so the tournament/tenant deletes below succeed.
  // 2. tournament_matches / tournament_teams / tournament_groups
  //    (FK to tournament_id) — cleared before tournaments.
  // 3. tournaments (FK to tenant_id) — cleared before tenant.
  // 4. courts / players / tenant_users (FK to tenant_id) — cleared before tenant.
  // 5. tenant itself.
  {
    const { error } = await admin
      .from("tournament_registrations")
      .delete()
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };
  }
  if (tournamentIds.length > 0) {
    for (const tbl of [
      "tournament_matches",
      "tournament_teams",
      "tournament_groups",
    ]) {
      const { error } = await admin
        .from(tbl)
        .delete()
        .in("tournament_id", tournamentIds);
      if (error) return { ok: false, error: error.message };
    }
  }
  for (const tbl of ["tournaments", "courts", "players", "tenant_users"]) {
    const { error } = await admin.from(tbl).delete().eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await admin.from("tenants").delete().eq("id", tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function provisionTenant(input: {
  slug: string;
  name: string;
  primary_color: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireSuperAdmin();
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!SLUG_RE.test(slug)) return { ok: false, error: "Slug måste vara 2–31 tecken (a–z, 0–9, -)" };
  if (slug === "www" || slug === "admin") return { ok: false, error: "Reserverad slug" };
  if (!name) return { ok: false, error: "Namn krävs" };

  const sb = await getSupabaseAuthServer();
  const { data, error } = await sb
    .from("tenants")
    .insert({ slug, name, primary_color: input.primary_color })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function inviteOwner(input: {
  tenantId: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSuperAdmin();
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Ogiltig e-post" };

  const admin = getServiceRoleClient();

  // Look up tenant slug for the redirect
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("slug")
    .eq("id", input.tenantId)
    .single();
  if (tErr || !tenant) return { ok: false, error: "Anläggning hittades inte" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "triadsolutions.se";
  const redirectTo = `https://${tenant.slug}.${baseUrl}/auth/callback?next=${encodeURIComponent("/auth/set-password")}`;

  // inviteUserByEmail creates the user and emails a magic-link invite
  const { data: invite, error: invErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo }
  );

  let userId = invite?.user?.id;

  // If the user already exists, inviteUserByEmail errors. Look them up and
  // send a fresh magic link instead.
  if (invErr || !userId) {
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = existing?.users?.find((x) => x.email?.toLowerCase() === email);
    if (!u) return { ok: false, error: invErr?.message ?? "Kunde inte skicka inbjudan" };
    userId = u.id;
    // Send a magic link the user can click to sign in
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkErr) return { ok: false, error: linkErr.message };
  }

  // Idempotently link the user to this tenant as owner
  const { error: linkErr } = await admin
    .from("tenant_users")
    .upsert({ tenant_id: input.tenantId, user_id: userId, role: "owner" });
  if (linkErr) return { ok: false, error: linkErr.message };

  return { ok: true };
}
