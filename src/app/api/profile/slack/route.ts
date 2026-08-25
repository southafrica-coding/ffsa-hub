import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { linkByMemberId, unlinkSlack } from "@/services/slack-links";

// Link / unlink the signed-in user's own Slack account.
//
// Writes go through the admin client because users.slack_user_id is
// not self-writable under RLS — the uniqueness check in
// memberIdTakenBy has to see every row to be meaningful, and a user
// can only ever act on their own id here.

// POST /api/profile/slack  { memberId: "U01AB2CD3EF" }
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!memberId.trim()) {
    return NextResponse.json(
      { error: "Please paste your Slack member ID." },
      { status: 400 }
    );
  }

  const result = await linkByMemberId(createAdminClient(), {
    userId: user.id,
    memberId,
    source: "self",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, user: result.user });
}

// DELETE /api/profile/slack — "that isn't me" / stop DMs entirely.
export async function DELETE() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const ok = await unlinkSlack(createAdminClient(), user.id);
  if (!ok) {
    return NextResponse.json(
      { error: "Couldn't unlink. Please try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
