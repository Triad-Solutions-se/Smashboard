-- Enable RLS on the four tables flagged by Supabase advisor.
--
-- tenant_users / super_admins: these are queried with the user's JWT, so we
-- can restrict reads to the requesting user's own rows. Admin mutations go
-- through the service role key which bypasses RLS entirely.
--
-- tournament_registrations / round_rests: the app uses the plain anon key
-- (no user session) for reads and writes, so policies must permit anon
-- access to keep existing functionality. This at least makes the access
-- explicit and allows future tightening as auth patterns evolve.

-- ── tenant_users ─────────────────────────────────────────────────────────────
alter table tenant_users enable row level security;

-- Each user can read their own tenant memberships.
create policy "tenant_users: own rows"
  on tenant_users
  for select
  using (auth.uid() = user_id);

-- ── super_admins ─────────────────────────────────────────────────────────────
alter table super_admins enable row level security;

-- A super admin can read their own row (used by requireTenantAccess and
-- requireSuperAdmin to verify access).
create policy "super_admins: own row select"
  on super_admins
  for select
  using (auth.uid() = user_id);

-- The bootstrap flow in requireSuperAdmin inserts via the auth server client,
-- so we need authenticated users to be able to insert their own row when no
-- super admins exist yet.
create policy "super_admins: self insert"
  on super_admins
  for insert
  with check (auth.uid() = user_id);

-- ── tournament_registrations ──────────────────────────────────────────────────
alter table tournament_registrations enable row level security;

-- The register_for_tournament and approve_registration RPCs are SECURITY
-- DEFINER and bypass RLS. Direct reads/writes (host view, cancel flow) use
-- the anon key without a user session, so we keep these permissive.
create policy "tournament_registrations: anon read"
  on tournament_registrations
  for select
  using (true);

create policy "tournament_registrations: anon write"
  on tournament_registrations
  for update
  using (true)
  with check (true);

-- ── round_rests ───────────────────────────────────────────────────────────────
alter table round_rests enable row level security;

-- Read by anon (TV display). Written by the host planning flow, also via the
-- anon key client. Keep permissive until the client is upgraded to carry a
-- user session.
create policy "round_rests: anon read"
  on round_rests
  for select
  using (true);

create policy "round_rests: anon write"
  on round_rests
  for insert
  with check (true);

create policy "round_rests: anon delete"
  on round_rests
  for delete
  using (true);
