import { supabaseClient } from "../supabase/client";
import { getSupabaseServer } from "../supabase/server";
import type {
  Tournament,
  TournamentFormat,
  GroupFormation,
  TournamentGroup,
  TournamentTeam,
  TournamentMatch,
  RoundRest,
} from "../supabase/types";

export async function getTournamentById(id: string): Promise<Tournament | null> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as Tournament | null;
}

export async function getTournamentByIdClient(id: string): Promise<Tournament | null> {
  const { data, error } = await supabaseClient
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as Tournament | null;
}

export async function getTournamentsByTenant(tenantId: string): Promise<Tournament[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("tournaments")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Tournament[];
}

export async function completeTournament(id: string): Promise<void> {
  const { error } = await supabaseClient
    .from("tournaments")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) throw error;
}

export async function setTournamentArchived(
  id: string,
  archived: boolean
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournaments")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

// Removes a tournament and everything it owns. Children are deleted
// explicitly in dependency order so we don't rely on FK cascade config
// (we know at least one related FK — courts — isn't cascade).
export async function deleteTournament(id: string): Promise<void> {
  const sb = supabaseClient;
  {
    const { error } = await sb
      .from("tournament_matches")
      .delete()
      .eq("tournament_id", id);
    if (error) throw error;
  }
  {
    const { error } = await sb
      .from("tournament_teams")
      .delete()
      .eq("tournament_id", id);
    if (error) throw error;
  }
  {
    const { error } = await sb
      .from("tournament_groups")
      .delete()
      .eq("tournament_id", id);
    if (error) throw error;
  }
  {
    const { error } = await sb.from("tournaments").delete().eq("id", id);
    if (error) throw error;
  }
}

// Wipes all groups, matches, and group assignments for a draft tournament so a
// fresh start can be made without stale data from a previous (possibly failed)
// submission causing teams to appear in multiple groups.
export async function resetTournamentGroupData(tournamentId: string): Promise<void> {
  const sb = supabaseClient;
  // Delete matches first (they reference groups and teams).
  const { error: matchErr } = await sb
    .from("tournament_matches")
    .delete()
    .eq("tournament_id", tournamentId);
  if (matchErr) throw matchErr;
  // Clear team group assignments.
  const { error: teamErr } = await sb
    .from("tournament_teams")
    .update({ group_id: null })
    .eq("tournament_id", tournamentId);
  if (teamErr) throw teamErr;
  // Delete groups.
  const { error: groupErr } = await sb
    .from("tournament_groups")
    .delete()
    .eq("tournament_id", tournamentId);
  if (groupErr) throw groupErr;
}

export type CreateTournamentInput = {
  tenant_id: string;
  name: string;
  format: TournamentFormat;
  formation: GroupFormation;
  num_groups: number;
  games_per_match: number;
  total_rounds: number;
};

export async function createTournament(input: CreateTournamentInput): Promise<Tournament> {
  const { data, error } = await supabaseClient
    .from("tournaments")
    .insert({
      ...input,
      status: "active",
      current_round: 1,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Tournament;
}

export type CreateDraftInput = {
  tenant_id: string;
  name: string;
  format: TournamentFormat;
  scheduled_at: string | null;
  open_registration?: boolean;
  max_teams?: number | null;
};

export async function createDraftTournament(
  input: CreateDraftInput
): Promise<Tournament> {
  const { data, error } = await supabaseClient
    .from("tournaments")
    .insert({
      tenant_id: input.tenant_id,
      name: input.name,
      format: input.format,
      scheduled_at: input.scheduled_at,
      open_registration: input.open_registration ?? false,
      max_teams: input.open_registration ? (input.max_teams ?? null) : null,
      status: "draft",
      formation: "random",
      num_groups: 0,
      games_per_match: 0,
      total_rounds: 0,
      current_round: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Tournament;
}

export type UpdateDraftPlanInput = {
  name: string;
  format: TournamentFormat;
  scheduled_at: string | null;
};

export async function updateDraftPlan(
  id: string,
  patch: UpdateDraftPlanInput
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournaments")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function addDraftTeam(
  tournamentId: string,
  player1_id: string,
  player2_id: string | null
): Promise<TournamentTeam> {
  const { data, error } = await supabaseClient
    .from("tournament_teams")
    .insert({
      tournament_id: tournamentId,
      group_id: null,
      player1_id,
      player2_id,
      seed: null,
      player1_paid_at: null,
      player2_paid_at: null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as TournamentTeam;
}

export async function updateDraftTeam(
  teamId: string,
  patch: { player1_id: string; player2_id: string | null }
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournament_teams")
    .update(patch)
    .eq("id", teamId);
  if (error) throw error;
}

export async function deleteDraftTeam(teamId: string): Promise<void> {
  const { error } = await supabaseClient
    .from("tournament_teams")
    .delete()
    .eq("id", teamId);
  if (error) throw error;
}

export async function assignTeamGroup(
  teamId: string,
  groupId: string
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournament_teams")
    .update({ group_id: groupId })
    .eq("id", teamId);
  if (error) throw error;
}

export async function assignTeamSeed(
  teamId: string,
  seed: number | null
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournament_teams")
    .update({ seed })
    .eq("id", teamId);
  if (error) throw error;
}

export type ActivateTournamentInput = {
  num_groups: number;
  games_per_match: number;
  total_rounds: number;
  formation: GroupFormation;
  advances_per_group?: number | null;
  has_bronze?: boolean;
  qf_court_ids?: string[];
  sf_court_ids?: string[];
  final_court_ids?: string[];
};

export async function activateTournament(
  id: string,
  input: ActivateTournamentInput
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournaments")
    .update({
      ...input,
      status: "active",
      current_round: 1,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function insertGroups(
  rows: Omit<TournamentGroup, "id">[]
): Promise<TournamentGroup[]> {
  const { data, error } = await supabaseClient
    .from("tournament_groups")
    .insert(rows)
    .select();
  if (error) throw error;
  return (data ?? []) as TournamentGroup[];
}

export async function insertTeams(
  rows: Omit<TournamentTeam, "id">[]
): Promise<TournamentTeam[]> {
  const { data, error } = await supabaseClient
    .from("tournament_teams")
    .insert(rows)
    .select();
  if (error) throw error;
  return (data ?? []) as TournamentTeam[];
}

export async function insertMatches(
  rows: Omit<TournamentMatch, "id" | "created_at">[]
): Promise<TournamentMatch[]> {
  const { data, error } = await supabaseClient
    .from("tournament_matches")
    .insert(rows)
    .select();
  if (error) throw error;
  return (data ?? []) as TournamentMatch[];
}

export async function getTeamsByTournament(
  tournamentId: string
): Promise<TournamentTeam[]> {
  const { data, error } = await supabaseClient
    .from("tournament_teams")
    .select("*")
    .eq("tournament_id", tournamentId);
  if (error) throw error;
  return (data ?? []) as TournamentTeam[];
}

export async function getTeamsByTournamentServer(
  tournamentId: string
): Promise<TournamentTeam[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("tournament_teams")
    .select("*")
    .eq("tournament_id", tournamentId);
  if (error) throw error;
  return (data ?? []) as TournamentTeam[];
}

export type PlannedSessionStats = {
  tournament_id: string;
  team_count: number;
  pending_count: number;
  solo_count: number;
};

export async function getPlannedStats(
  tournamentIds: string[]
): Promise<PlannedSessionStats[]> {
  if (tournamentIds.length === 0) return [];
  const sb = getSupabaseServer();

  const [{ data: regs, error: regErr }, { data: teams, error: teamErr }] =
    await Promise.all([
      sb
        .from("tournament_registrations")
        .select("tournament_id, status")
        .in("tournament_id", tournamentIds),
      sb
        .from("tournament_teams")
        .select("tournament_id, player2_id")
        .in("tournament_id", tournamentIds),
    ]);

  if (regErr) throw regErr;
  if (teamErr) throw teamErr;

  const map = new Map<string, PlannedSessionStats>();
  for (const id of tournamentIds) {
    map.set(id, { tournament_id: id, team_count: 0, pending_count: 0, solo_count: 0 });
  }
  for (const r of regs ?? []) {
    const s = map.get(r.tournament_id);
    if (!s) continue;
    if (r.status === "pending") s.pending_count++;
  }
  for (const t of teams ?? []) {
    const s = map.get(t.tournament_id);
    if (!s) continue;
    s.team_count++;
    if (!t.player2_id) s.solo_count++;
  }
  return [...map.values()];
}

export async function setPlayerPaid(
  teamId: string,
  slot: 1 | 2,
  paid: boolean
): Promise<void> {
  const column = slot === 1 ? "player1_paid_at" : "player2_paid_at";
  const { error } = await supabaseClient
    .from("tournament_teams")
    .update({ [column]: paid ? new Date().toISOString() : null })
    .eq("id", teamId);
  if (error) throw error;
}

export async function getGroupsByTournament(
  tournamentId: string
): Promise<TournamentGroup[]> {
  const { data, error } = await supabaseClient
    .from("tournament_groups")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as TournamentGroup[];
}

export async function insertRoundRests(
  rows: Omit<RoundRest, "id">[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseClient
    .from("round_rests")
    .insert(rows);
  if (error) throw error;
}

export async function getRoundRests(
  tournamentId: string
): Promise<RoundRest[]> {
  const { data, error } = await supabaseClient
    .from("round_rests")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("round_number");
  if (error) throw error;
  return (data ?? []) as RoundRest[];
}

export async function updateGamesPerMatch(
  id: string,
  gamesPerMatch: number
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournaments")
    .update({ games_per_match: gamesPerMatch })
    .eq("id", id);
  if (error) throw error;
}

// Reassigns scheduled (un-played) group-stage matches round-robin across the
// given courts, preserving the per-(group, round) distribution shape that
// generateGroupMatches uses at activation. KO matches and any in-progress or
// completed matches are left untouched.
export async function reassignScheduledGroupCourts(
  tournamentId: string,
  courtIds: string[]
): Promise<void> {
  if (courtIds.length === 0) {
    throw new Error("Minst en bana måste vara vald.");
  }
  const sb = supabaseClient;
  const { data, error } = await sb
    .from("tournament_matches")
    .select("id, group_id, round_number, court_id, created_at")
    .eq("tournament_id", tournamentId)
    .eq("stage", "group")
    .eq("status", "scheduled")
    .order("round_number")
    .order("created_at")
    .order("id");
  if (error) throw error;
  const matches = (data ?? []) as Array<{
    id: string;
    group_id: string | null;
    round_number: number;
    court_id: string | null;
    created_at: string;
  }>;

  const buckets = new Map<string, typeof matches>();
  for (const m of matches) {
    const key = `${m.group_id ?? ""}:${m.round_number}`;
    const arr = buckets.get(key) ?? [];
    arr.push(m);
    buckets.set(key, arr);
  }

  const updates: Array<{ id: string; court_id: string }> = [];
  for (const arr of buckets.values()) {
    arr.forEach((m, idx) => {
      const newCourt = courtIds[idx % courtIds.length];
      if (m.court_id !== newCourt) {
        updates.push({ id: m.id, court_id: newCourt });
      }
    });
  }

  for (const u of updates) {
    const { error: updErr } = await sb
      .from("tournament_matches")
      .update({ court_id: u.court_id })
      .eq("id", u.id);
    if (updErr) throw updErr;
  }
}

export async function updateTournamentPlayoffSettings(
  id: string,
  advancesPerGroup: number | null,
  hasBronze: boolean
): Promise<void> {
  const { error } = await supabaseClient
    .from("tournaments")
    .update({ advances_per_group: advancesPerGroup, has_bronze: hasBronze })
    .eq("id", id);
  if (error) throw error;
}

export async function duplicateTournamentAsDraft(
  sourceId: string,
  tenantId: string
): Promise<Tournament> {
  const sb = supabaseClient;

  const { data: source, error: srcErr } = await sb
    .from("tournaments")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (srcErr) throw srcErr;

  const { data: newTournament, error: insertErr } = await sb
    .from("tournaments")
    .insert({
      tenant_id: tenantId,
      name: `${source.name} (kopia)`,
      format: source.format,
      scheduled_at: null,
      open_registration: false,
      max_teams: null,
      status: "draft",
      formation: "random",
      num_groups: 0,
      games_per_match: 0,
      total_rounds: 0,
      current_round: 0,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  const { data: sourceTeams, error: teamsErr } = await sb
    .from("tournament_teams")
    .select("player1_id, player2_id")
    .eq("tournament_id", sourceId);
  if (teamsErr) throw teamsErr;

  if (sourceTeams && sourceTeams.length > 0) {
    const { error: copyErr } = await sb.from("tournament_teams").insert(
      sourceTeams.map((t) => ({
        tournament_id: newTournament.id,
        group_id: null,
        player1_id: t.player1_id,
        player2_id: t.player2_id,
        seed: null,
        player1_paid_at: null,
        player2_paid_at: null,
      }))
    );
    if (copyErr) throw copyErr;
  }

  return newTournament as Tournament;
}
