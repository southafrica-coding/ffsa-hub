// Operations — data access (migrations 400/401). Pure queries: callers
// pick the client (user client for pages and routes, admin client for the
// Slack intake, morning messages and reminders).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Items
// ────────────────────────────────────────────────────────────

export const ITEM_SELECT =
  "id, area, title, details, location, status, owner_user_id, due_on, source, requested_by_name, requested_by_slack_id, requested_by_user_id, slack_channel, slack_ts, created_by, created_at, updated_at, last_activity_at, closed_at, urgency, photo_count, out_of_hours, owner:users!ops_items_owner_user_id_fkey(display_name, slack_user_id)";

export function listOpenItems(supabase: Client, options?: { area?: string; ownerUserId?: string }) {
  let query = supabase.from("ops_items").select(ITEM_SELECT).is("closed_at", null).order("created_at", { ascending: false });
  if (options?.area) query = query.eq("area", options.area);
  if (options?.ownerUserId) query = query.eq("owner_user_id", options.ownerUserId);
  return query;
}

export function listClosedSince(supabase: Client, sinceIso: string, options?: { area?: string }) {
  let query = supabase
    .from("ops_items")
    .select(ITEM_SELECT)
    .gte("closed_at", sinceIso)
    .order("closed_at", { ascending: false });
  if (options?.area) query = query.eq("area", options.area);
  return query;
}

/** Open items with a due date in [from, to] (SAST dates), owner set. */
export function listDueBetween(supabase: Client, from: string, to: string) {
  return supabase
    .from("ops_items")
    .select(ITEM_SELECT)
    .is("closed_at", null)
    .not("owner_user_id", "is", null)
    .gte("due_on", from)
    .lte("due_on", to);
}

/** Maintenance requests for a month's report: came in before `end`, still open at `start` or later. */
export function listMaintenanceForReport(supabase: Client, start: string, end: string) {
  return supabase
    .from("ops_items")
    .select(ITEM_SELECT)
    .eq("area", "maintenance")
    .lt("created_at", end)
    .or(`closed_at.is.null,closed_at.gte.${start}`)
    .order("created_at", { ascending: true })
    .limit(2000);
}

export function getItem(supabase: Client, id: string) {
  return supabase.from("ops_items").select(ITEM_SELECT).eq("id", id).maybeSingle();
}

export function createItem(
  supabase: Client,
  row: {
    area: string;
    title: string;
    details?: string | null;
    location?: string | null;
    owner_user_id?: string | null;
    due_on?: string | null;
    source: "slack" | "hub" | "meeting";
    requested_by_name?: string | null;
    requested_by_slack_id?: string | null;
    requested_by_user_id?: string | null;
    slack_channel?: string | null;
    slack_ts?: string | null;
    created_by?: string | null;
    created_at?: string;
    urgency?: string | null;
    photo_count?: number;
    out_of_hours?: boolean;
  }
) {
  return supabase.from("ops_items").insert(row).select("id").single();
}

/** Insert a Slack request; a post already imported is skipped (null data). */
export function createItemFromSlack(supabase: Client, row: Parameters<typeof createItem>[1]) {
  return supabase
    .from("ops_items")
    .upsert(row, { onConflict: "slack_channel,slack_ts", ignoreDuplicates: true })
    .select("id");
}

export function updateItem(
  supabase: Client,
  id: string,
  patch: Partial<{
    status: string;
    owner_user_id: string | null;
    due_on: string | null;
    title: string;
    details: string | null;
    location: string | null;
    area: string;
    slack_channel: string | null;
    slack_ts: string | null;
    photo_count: number;
  }>
) {
  return supabase.from("ops_items").update(patch).eq("id", id).select("id").single();
}

// ────────────────────────────────────────────────────────────
// Updates (the log)
// ────────────────────────────────────────────────────────────

export type UpdateRow = {
  item_id: string;
  author_user_id: string | null;
  author_name?: string | null;
  kind: "created" | "status" | "note" | "assign" | "due";
  status_to?: string | null;
  owner_to?: string | null;
  due_to?: string | null;
  note?: string | null;
  via: "hub" | "slack" | "meeting";
};

export function addUpdates(supabase: Client, rows: UpdateRow[]) {
  return supabase.from("ops_item_updates").insert(rows);
}

export function getItemUpdates(supabase: Client, itemId: string) {
  return supabase
    .from("ops_item_updates")
    .select(
      "id, kind, status_to, due_to, note, via, author_name, created_at, author:users!ops_item_updates_author_user_id_fkey(display_name), owner:users!ops_item_updates_owner_to_fkey(display_name)"
    )
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────

export type OpsSettings = {
  maintenance_intake_channel: string | null;
  ops_channel: string | null;
  area_channels: Record<string, string>;
  last_intake_ts: string | null;
  // Maintenance requests (migration 405)
  maintenance_button_channel: string | null;
  maintenance_button_ts: string | null;
  maintenance_followup_channel: string | null;
  maintenance_status_user_ids: string[];
  maintenance_rules: string | null;
  maintenance_hours_notice: string;
  /** Crew hours by weekday, SAST: {"1": {"open": "08:00", "close": "16:00"}, …} */
  maintenance_hours: Record<string, { open: string; close: string }>;
};

const SETTINGS_SELECT =
  "maintenance_intake_channel, ops_channel, area_channels, last_intake_ts, maintenance_button_channel, maintenance_button_ts, maintenance_followup_channel, maintenance_status_user_ids, maintenance_rules, maintenance_hours_notice, maintenance_hours";

export function getSettings(supabase: Client) {
  return supabase
    .from("ops_settings")
    .select(SETTINGS_SELECT)
    .eq("id", true)
    .maybeSingle();
}

export function updateSettings(supabase: Client, patch: Partial<OpsSettings>) {
  return supabase
    .from("ops_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("id")
    .single();
}

// ────────────────────────────────────────────────────────────
// People who can be given a task
// ────────────────────────────────────────────────────────────

/**
 * Who a task can be given to: the Operations department's active members
 * and leaders, plus operations.team helpers (direct or via a role bundle).
 * Admins are not added just for being admins. Active accounts only.
 * Read with the admin client.
 */
export async function listOpsTeam(admin: Client): Promise<{ id: string; name: string; slackUserId: string | null }[]> {
  const { data: perm } = await admin.from("permissions").select("id").eq("key", "operations.team").maybeSingle();
  const ids = new Set<string>();
  if (perm?.id) {
    const [{ data: direct }, { data: bundles }] = await Promise.all([
      admin.from("user_permissions").select("user_id").eq("permission_id", perm.id),
      admin.from("role_permissions").select("role_id").eq("permission_id", perm.id),
    ]);
    for (const r of (direct ?? []) as { user_id: string }[]) ids.add(r.user_id);
    const roleIds = ((bundles ?? []) as { role_id: string }[]).map((r) => r.role_id);
    if (roleIds.length) {
      const { data: holders } = await admin.from("user_roles").select("user_id").in("role_id", roleIds);
      for (const r of (holders ?? []) as { user_id: string }[]) ids.add(r.user_id);
    }
  }
  // The Operations department's roster (staff ministry slug 'operations').
  const { data: members } = await admin
    .from("staff_ministry_members")
    .select("user_id, staff_ministries!inner(slug, is_active)")
    .eq("status", "active")
    .eq("staff_ministries.slug", "operations")
    .eq("staff_ministries.is_active", true);
  for (const r of (members ?? []) as { user_id: string }[]) ids.add(r.user_id);
  if (ids.size === 0) return [];
  const { data: users } = await admin
    .from("users")
    .select("id, display_name, slack_user_id, is_active, person:people(first_name, last_name)")
    .in("id", [...ids])
    .eq("is_active", true);
  return ((users ?? []) as {
    id: string;
    display_name: string | null;
    slack_user_id: string | null;
    person: { first_name?: string; last_name?: string } | null;
  }[])
    .map((u) => ({
      id: u.id,
      name: u.display_name || [u.person?.first_name, u.person?.last_name].filter(Boolean).join(" ") || "Unnamed",
      slackUserId: u.slack_user_id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getUserBrief(admin: Client, userId: string) {
  return admin
    .from("users")
    .select("id, display_name, slack_user_id, person:people(first_name, last_name)")
    .eq("id", userId)
    .maybeSingle();
}

// ────────────────────────────────────────────────────────────
// Sent-message logs (admin client)
// ────────────────────────────────────────────────────────────

export type DigestKind = "morning" | "weekly" | "recap" | "followup";

export function lastDigest(admin: Client, kind: DigestKind, area?: string) {
  let query = admin.from("ops_digest_log").select("sent_at").eq("kind", kind).order("sent_at", { ascending: false }).limit(1);
  query = area ? query.eq("area", area) : query.is("area", null);
  return query.maybeSingle();
}

export function logDigest(
  admin: Client,
  row: { kind: DigestKind; area?: string | null; channel?: string | null; slack_ts?: string | null }
) {
  return admin.from("ops_digest_log").insert(row);
}

/** Claim a reminder; false if it was already sent. */
export async function claimReminder(
  admin: Client,
  row: { item_id: string; kind: string; due_on: string | null; user_id: string }
): Promise<boolean> {
  const { error } = await admin.from("ops_reminder_log").insert(row);
  return !error;
}
