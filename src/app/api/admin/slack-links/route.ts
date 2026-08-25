import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import {
  autoMatchByEmail,
  linkByMemberId,
  unlinkSlack,
} from "@/services/slack-links";

// Admin-side Slack link management: bulk email auto-match, plus
// setting or clearing one person's member id by hand.

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await callerIsAdmin(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Not allowed" }, { status: 403 }) };
  }
  return { userId: user.id };
}

// POST /api/admin/slack-links  { action: "auto_match" }
//                              { action: "set", userId, memberId }
//                              { action: "clear", userId }
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  const admin = createAdminClient();

  if (action === "auto_match") {
    // Paced Slack lookups, one per unlinked user — this can take a
    // while on a first run, which is why the button says so.
    const result = await autoMatchByEmail(admin);
    return NextResponse.json({ ok: true, result });
  }

  if (action === "set") {
    if (typeof body?.userId !== "string" || typeof body?.memberId !== "string") {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const result = await linkByMemberId(admin, {
      userId: body.userId,
      memberId: body.memberId,
      source: "admin",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, user: result.user });
  }

  if (action === "clear") {
    if (typeof body?.userId !== "string") {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const ok = await unlinkSlack(admin, body.userId);
    if (!ok) {
      return NextResponse.json({ error: "Couldn't unlink." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
