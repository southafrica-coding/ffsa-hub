import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPrayerRoomStaff } from "@/lib/auth/prayer-room-access";
import { getAlertRecipientIds, syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Person = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; slack_user_id: string | null };
const nameOf = (p: Person) => `${p.preferred_name || p.first_name || ""} ${p.last_name || ""}`.trim() || "Unnamed";

/** Everyone who can manage the prayer room — the people an alert can go to. */
async function managers(admin: Client): Promise<Person[]> {
  const fields = "id, first_name, last_name, preferred_name, slack_user_id";
  const [byRole, byPerm] = await Promise.all([
    admin
      .from("user_roles")
      .select(`user:users!user_roles_user_id_fkey(${fields}), roles!inner(name)`)
      .in("roles.name", ["super_admin", "admin", "prayer_room_admin"]),
    admin
      .from("user_permissions")
      .select(`user:users!user_permissions_user_id_fkey(${fields}), permissions!inner(key)`)
      .eq("permissions.key", "prayer_room.manage"),
  ]);
  const out = new Map<string, Person>();
  for (const r of [...(byRole.data ?? []), ...(byPerm.data ?? [])] as { user: Person | null }[]) {
    if (r.user) out.set(r.user.id, r.user);
  }
  return [...out.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

async function staff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await isPrayerRoomStaff(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { user };
}

// GET — who gets the Auditorium-booking DMs, plus who could.
export async function GET() {
  const auth = await staff();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient() as Client;
  const [ids, people] = await Promise.all([getAlertRecipientIds(admin), managers(admin)]);
  const chosen = new Set(ids);
  return NextResponse.json({
    candidates: people.map((p) => ({ id: p.id, name: nameOf(p), slackLinked: !!p.slack_user_id, chosen: chosen.has(p.id) })),
  });
}

// PUT { userIds } — replace the recipient list (managers only).
export async function PUT(request: Request) {
  const auth = await staff();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const requested: string[] = Array.isArray(body.userIds)
    ? (body.userIds as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const admin = createAdminClient() as Client;
  const allowed = new Set((await managers(admin)).map((p) => p.id));
  const userIds = [...new Set(requested)].filter((id) => allowed.has(id));

  const { error } = await admin.from("prayer_room_settings").update({ booking_alert_user_ids: userIds }).eq("id", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Someone newly added gets the alerts that are already open.
  after(syncBookingAlerts);
  return NextResponse.json({ ok: true, userIds });
}
