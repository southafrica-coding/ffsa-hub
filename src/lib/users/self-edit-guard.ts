import { NextResponse } from "next/server";
import { DEACTIVATED_ACCOUNT_MESSAGE } from "@/lib/users/users-update-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type SelfActor = {
  is_active: boolean | null;
  signup_type: string | null;
  department: string | null;
  status: string | null;
  accepted_at: string | null;
  marital_status: string | null;
};

export function deactivatedResponse(): NextResponse {
  return NextResponse.json({ error: DEACTIVATED_ACCOUNT_MESSAGE }, { status: 403 });
}

/**
 * The caller's own users row, or a 403. Missing row, read error, and
 * is_active IS NOT TRUE all fail closed — the same bar as the 315 trigger
 * ("A deactivated account changes nothing, its own row included.").
 */
export async function readSelfActor(
  supabase: Client,
  userId: string
): Promise<{ ok: true; row: SelfActor } | { ok: false; response: NextResponse }> {
  const { data, error } = await supabase
    .from("users")
    .select("is_active, signup_type, department, status, accepted_at, marital_status")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || data.is_active !== true) {
    return { ok: false, response: deactivatedResponse() };
  }

  return { ok: true, row: data as SelfActor };
}

export async function rejectIfDeactivated(
  supabase: Client,
  userId: string
): Promise<NextResponse | null> {
  const actor = await readSelfActor(supabase, userId);
  return actor.ok ? null : actor.response;
}
