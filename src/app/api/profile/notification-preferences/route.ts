import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { BROADCAST_MODULES } from "@/lib/slack/broadcast-types";

// Per-module mute toggles for the signed-in user.
//
// Preferences only ever SUBTRACT from a derived recipient list, so
// there is nothing to subscribe to here — the body is just the set of
// modules to silence. Runs on the RLS client: 069 + 187 give a user
// select/insert/update on their own prefs row and nothing else.

// PUT /api/profile/notification-preferences  { mutedModules: ["prayer_room"] }
export async function PUT(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const raw = body?.mutedModules;
  if (!Array.isArray(raw) || raw.some((m) => typeof m !== "string")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Only accept keys the registry knows about, so a stale client can't
  // write junk that the mute lookup would then never match.
  const known = new Set(Object.keys(BROADCAST_MODULES));
  const mutedModules = Array.from(new Set(raw as string[])).filter((m) =>
    known.has(m)
  );

  // The prefs row is created lazily — upsert covers both the first
  // toggle and every one after it.
  // Generated types predate 069/187 — cast per repo convention.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, muted_modules: mutedModules },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[notification-preferences] upsert failed", error);
    return NextResponse.json(
      { error: "Couldn't save your preferences. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, mutedModules });
}
