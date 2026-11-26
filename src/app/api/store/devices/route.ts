import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getBuyer } from "@/lib/store/access";
import { deviceLabel, hashDeviceId } from "@/lib/store/devices";
import { STORE_DEVICE_LIMIT } from "@/lib/store/flags";
import { registerDevice } from "@/services/store";
import { bad, NO_STORE, readJson } from "../_shared";

// POST /api/store/devices — register this browser as a reading device.
// 409 { limit: true } when three others are active.
export async function POST(request: Request) {
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) return bad("Sign in to read", 401);
  const body = (await readJson(request)) as { deviceId?: unknown } | null;
  const hash = typeof body?.deviceId === "string" ? hashDeviceId(body.deviceId) : null;
  if (!hash) return bad("This browser couldn't be identified. Allow site storage and try again.");

  const { data, error } = await registerDevice(storeAdminClient(), {
    userId: buyer.userId,
    deviceHash: hash,
    label: deviceLabel(request.headers.get("user-agent")),
    limit: STORE_DEVICE_LIMIT,
  });
  if (error) return bad("We couldn't check your devices. Try again.", 500);
  if (data === "limit") {
    return NextResponse.json(
      { error: `You're reading on ${STORE_DEVICE_LIMIT} devices already. Remove one to read here.`, limit: true },
      { status: 409, headers: NO_STORE }
    );
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
