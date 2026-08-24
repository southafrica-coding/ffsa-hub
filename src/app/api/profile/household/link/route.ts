import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";

// Confirm / decline a pending household match, or leave a linked household.
//
// A pending match (users.pending_household_id, set at signup by
// link_household_on_signup) grants no access on its own: household_id stays
// NULL until the user confirms here. All three actions are SECURITY DEFINER
// functions in migration 181 that re-check the claim under a lock, so a race
// between two accounts claiming the same spouse row resolves cleanly.

// POST /api/profile/household/link  { action: "confirm" | "decline" }
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "confirm" && action !== "decline") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // The generated Database types predate migration 181 — cast per repo
  // convention (same as the onboarding_invites / library RPC call sites).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    action === "confirm" ? "confirm_household_link" : "decline_household_link"
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Someone else claimed the spouse record first — the pending match is
  // cleared, so tell the caller rather than silently doing nothing.
  const status = (data as { status?: string } | null)?.status;
  if (status === "already_claimed") {
    return NextResponse.json(
      {
        error:
          "That household has already been linked to another account. Please ask them to check, or continue and add your family yourself.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, status: status ?? "ok" });
}

// DELETE /api/profile/household/link — leave the shared household.
// Family records stay with the original household (see unlink_household).
export async function DELETE() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("unlink_household");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
