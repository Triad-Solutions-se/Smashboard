import { supabaseClient } from "../supabase/client";
import { getSupabaseServer } from "../supabase/server";
import type { Tenant } from "../supabase/types";

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("tenants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as Tenant | null;
}

export async function updateTenant(
  id: string,
  patch: Partial<Pick<Tenant, "name" | "primary_color" | "logo_url" | "logo_url_dark">>
): Promise<Tenant> {
  const { data, error } = await supabaseClient
    .from("tenants")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Tenant;
}
