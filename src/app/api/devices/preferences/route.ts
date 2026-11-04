import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { isPushCategory, pushCategoryList } from "@/lib/push/categories";
import { isMissingSchema } from "@/lib/push/schema-errors";
import { getOwnPushMutes, setOwnPushMutes } from "@/lib/push/store";

// GET /api/devices/preferences
//   → { categories: [{ key, label, description }], muted: ["booking_requests"] }
// PUT /api/devices/preferences  { muted: ["booking_requests"] }
//   → { ok: true, muted }
//
// The caller's phone-push category opt-outs (Me > Notifications in the app).
// Stored on their own notification_preferences row (push_muted_kinds, 288),
// on their own RLS client, like /api/profile/notification-preferences. Only
// the push column is written, so their Slack mutes are left alone.
// Until migration 288 is applied: 503 {"error":"push_not_enabled"}.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const notEnabled = () =>
  json(
    { error: "push_not_enabled", message: "Push notifications aren't switched on for FFSA Hub yet." },
    503
  );

const putSchema = z.object({ muted: z.array(z.string().max(64)).max(50) });

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const { data, error } = await getOwnPushMutes(supabase, user.id);
  if (error) {
    if (isMissingSchema(error)) return notEnabled();
    console.error("[devices/preferences] read failed", error.code ?? "");
    return json({ error: "server_error", message: "Couldn't load your push settings. Try again." }, 500);
  }

  const muted = ((data as { push_muted_kinds: string[] | null } | null)?.push_muted_kinds ?? []).filter(
    isPushCategory
  );
  return json({ categories: pushCategoryList(), muted });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const parsed = putSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return json({ error: "bad_request", message: "That isn't a valid list of settings." }, 400);
  }
  // Unknown keys are dropped, so a stale app can't store junk.
  const muted = Array.from(new Set(parsed.data.muted)).filter(isPushCategory);

  const { error } = await setOwnPushMutes(supabase, user.id, muted);
  if (error) {
    if (isMissingSchema(error)) return notEnabled();
    console.error("[devices/preferences] save failed", error.code ?? "");
    return json({ error: "server_error", message: "Couldn't save your push settings. Try again." }, 500);
  }
  return json({ ok: true, muted });
}
