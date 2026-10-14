import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess, getVehicleManagerUserIds } from "@/services/vehicles";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

async function manager() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canManage)) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { user };
}

async function candidates(admin: Client) {
  const ids = await getVehicleManagerUserIds(admin);
  if (ids.length === 0) return [];
  const { data } = await admin.from("users").select("id, first_name, last_name, slack_user_id").in("id", ids);
  return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; slack_user_id: string | null }[])
    .map((u) => ({ id: u.id, name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Unnamed", slackLinked: !!u.slack_user_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// GET — who gets the vehicle Slack DMs, and who could (vehicle approvers/managers).
export async function GET() {
  const auth = await manager();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient() as Client;
  const [{ data: settings }, people] = await Promise.all([
    admin.from("vehicle_alert_settings").select("slack_alert_user_ids").maybeSingle(),
    candidates(admin),
  ]);
  const chosen = new Set<string>((settings?.slack_alert_user_ids as string[] | null) ?? []);
  return NextResponse.json({ candidates: people.map((p) => ({ ...p, chosen: chosen.has(p.id) })) });
}

// PUT { userIds } — replace the list (vehicle managers only).
export async function PUT(request: Request) {
  const auth = await manager();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient() as Client;
  const allowed = new Set((await candidates(admin)).map((p) => p.id));
  const userIds = Array.isArray(body.userIds)
    ? [...new Set((body.userIds as unknown[]).filter((v): v is string => typeof v === "string" && allowed.has(v)))]
    : [];
  const { error } = await admin
    .from("vehicle_alert_settings")
    .upsert({ id: true, slack_alert_user_ids: userIds, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, userIds });
}
