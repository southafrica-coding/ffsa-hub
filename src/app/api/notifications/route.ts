import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getNotifications } from "@/services/notifications";
import { toFeedPayload } from "@/lib/notifications-feed";

// GET /api/notifications — the signed-in user's notification feed, the same
// derived items the dashboard shows (src/services/notifications.ts), with
// read state. Bearer (phone app) or cookie (website). Every provider is
// permission-gated inside the service and reads through the caller's own
// client, so nobody sees an item the dashboard wouldn't show them.
// Contract: src/lib/notifications-feed.ts. Mark read: POST /api/notifications/read.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  // Providers already degrade to "no items" on failure; this catches anything
  // the service itself throws.
  try {
    const feed = await getNotifications(supabase, user.id);
    return NextResponse.json(toFeedPayload(feed), { headers: NO_STORE });
  } catch (err) {
    console.error("[notifications] feed failed", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't load notifications." },
      { status: 500, headers: NO_STORE }
    );
  }
}
