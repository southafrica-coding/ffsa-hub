// Shared bits for the Fleet route handlers (src/app/api/vehicles/fleet/*).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getFleetAccess, insertFleetTimeLog, type FleetAccess } from "@/services/fleet";
import { todayInSA, weekStartOf } from "./rules";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FleetAuth =
  | { ok: true; supabase: Client; user: { id: string }; access: FleetAccess }
  | { ok: false; response: NextResponse };

/** Auth check at the top of every Fleet route: 401 without a user, 403 without access. */
export async function fleetAuth(need: "view" | "manage" = "manage"): Promise<FleetAuth> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const access = await getFleetAccess(supabase, user.id);
  const allowed = need === "view" ? access.canView : access.canManage;
  if (!allowed) return { ok: false, response: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  return { ok: true, supabase, user, access };
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as T) : null;
  } catch {
    return null;
  }
}

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** The time tracker (SPEC 6.10): a modal counts the minutes it was open, 1–15. */
export async function logTime(
  supabase: Client,
  userId: string,
  entry: { kind: string; type?: string | null; vehicleId?: string | null; mins?: number | null }
) {
  const today = todayInSA();
  const mins = Math.max(1, Math.round(Number(entry.mins) || 1));
  await insertFleetTimeLog(supabase, {
    date: today,
    week: weekStartOf(today),
    kind: entry.kind,
    type: entry.type ?? null,
    vehicle_id: entry.vehicleId ?? null,
    mins,
    user_id: userId,
  });
}
