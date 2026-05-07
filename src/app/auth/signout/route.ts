import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthServer } from "@/lib/supabase/auth-server";

export async function POST(req: NextRequest) {
  const sb = await getSupabaseAuthServer();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
