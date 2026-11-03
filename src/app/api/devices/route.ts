import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { isMissingSchema } from "@/lib/push/schema-errors";
import { revokeOwnDevice, upsertDevice } from "@/lib/push/store";

// POST   /api/devices  { expoToken, platform, appVersion, deviceName? }
//   → { ok: true }    register this phone for push (the phone app, bearer)
// DELETE /api/devices  { expoToken }
//   → { ok: true, revoked }   stop pushing to this phone (sign-out)
//
// Only ever acts for the signed-in caller. Registering re-assigns a token
// that already belongs to someone else (same phone, new person signed in),
// which needs the service-role client because the old row is invisible
// under RLS; the row is always written with the CALLER's id. Revoking runs
// on the caller's own client, so RLS keeps it to their own phones.
//
// Until migration 288 is applied: 503 {"error":"push_not_enabled"}. The app
// reads that as "not switched on yet" and doesn't retry until next launch.

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

// "ExponentPushToken[…]" (current) or "ExpoPushToken[…]".
const expoToken = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/);

const registerSchema = z.object({
  expoToken,
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().trim().min(1).max(50),
  deviceName: z.string().trim().max(100).nullish(),
});

const revokeSchema = z.object({ expoToken });

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const parsed = registerSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return json({ error: "bad_request", message: "That isn't a valid phone registration." }, 400);
  }
  const body = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return notEnabled();
  }

  const { error } = await upsertDevice(admin, {
    user_id: user.id,
    expo_token: body.expoToken,
    platform: body.platform,
    app_version: body.appVersion,
    device_name: body.deviceName || null,
  });
  if (error) {
    if (isMissingSchema(error)) return notEnabled();
    console.error("[devices] register failed", error.code ?? "");
    return json({ error: "server_error", message: "Couldn't register this phone. Try again later." }, 500);
  }
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const parsed = revokeSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return json({ error: "bad_request", message: "That isn't a valid phone token." }, 400);
  }

  const { data, error } = await revokeOwnDevice(supabase, user.id, parsed.data.expoToken);
  if (error) {
    if (isMissingSchema(error)) return notEnabled();
    console.error("[devices] revoke failed", error.code ?? "");
    return json({ error: "server_error", message: "Couldn't update this phone. Try again later." }, 500);
  }
  return json({ ok: true, revoked: (data ?? []).length });
}
