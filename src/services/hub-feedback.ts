// Hub feedback — problems, ideas and vision about the Hub itself
// (migration 263). Pure data access; the rules live in RLS and in the
// route handlers under src/app/api/hub-feedback/.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const HUB_FEEDBACK_BUCKET = "hub-feedback";

export type HubFeedbackRow = {
  id: string;
  ref: number;
  kind: string;
  title: string;
  details: string | null;
  severity: string | null;
  status: string;
  status_note: string | null;
  status_changed_at: string;
  source: string;
  page_path: string | null;
  module_id: string | null;
  module_label: string | null;
  user_agent: string | null;
  viewport: string | null;
  submitted_by: string;
  assigned_to: string | null;
  duplicate_of: string | null;
  created_at: string;
  updated_at: string;
};

const ITEM_COLUMNS =
  "id, ref, kind, title, details, severity, status, status_note, status_changed_at, source, " +
  "page_path, module_id, module_label, user_agent, viewport, submitted_by, assigned_to, " +
  "duplicate_of, created_at, updated_at";

// ── Access ─────────────────────────────────────────────────

/** The SQL gates themselves, so pages and routes agree with RLS. */
export async function getHubFeedbackAccess(
  supabase: Client
): Promise<{ canView: boolean; canTriage: boolean }> {
  const [view, triage] = await Promise.all([
    supabase.rpc("can_view_hub_feedback"),
    supabase.rpc("can_triage_hub_feedback"),
  ]);
  return { canView: view.data === true, canTriage: triage.data === true };
}

// ── Items ──────────────────────────────────────────────────

export async function createHubFeedback(
  supabase: Client,
  row: {
    kind: string;
    title: string;
    details: string | null;
    severity: string | null;
    page_path: string | null;
    module_id: string | null;
    module_label: string | null;
    user_agent: string | null;
    viewport: string | null;
    submitted_by: string;
    source?: string;
  }
) {
  return supabase.from("hub_feedback").insert(row).select(ITEM_COLUMNS).single();
}

export async function getHubFeedbackById(supabase: Client, id: string) {
  return supabase.from("hub_feedback").select(ITEM_COLUMNS).eq("id", id).maybeSingle();
}

export async function getMyHubFeedback(supabase: Client, userId: string) {
  return supabase
    .from("hub_feedback")
    .select(ITEM_COLUMNS)
    .eq("submitted_by", userId)
    .order("created_at", { ascending: false })
    .limit(200);
}

/** The whole board, newest first. RLS limits it to the team. */
export async function getHubFeedbackBoard(supabase: Client) {
  return supabase
    .from("hub_feedback")
    .select(ITEM_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1000);
}

export async function updateHubFeedback(
  supabase: Client,
  id: string,
  patch: Partial<
    Pick<
      HubFeedbackRow,
      "kind" | "title" | "severity" | "status" | "status_note" | "assigned_to" | "duplicate_of" | "module_id" | "module_label"
    >
  >
) {
  return supabase.from("hub_feedback").update(patch).eq("id", id).select(ITEM_COLUMNS).maybeSingle();
}

/** Items merged into the given ones (so the board can say "3 reporters"). */
export async function getHubFeedbackDuplicates(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { data: [], error: null };
  return supabase
    .from("hub_feedback")
    .select("id, ref, title, submitted_by, duplicate_of, created_at")
    .in("duplicate_of", ids);
}

// ── Comments ───────────────────────────────────────────────

export async function getHubFeedbackComments(supabase: Client, feedbackId: string) {
  return supabase
    .from("hub_feedback_comments")
    .select("id, feedback_id, author_id, visibility, body, created_at")
    .eq("feedback_id", feedbackId)
    .order("created_at");
}

export async function insertHubFeedbackComment(
  supabase: Client,
  row: { feedback_id: string; author_id: string; visibility: "team" | "submitter"; body: string }
) {
  return supabase
    .from("hub_feedback_comments")
    .insert(row)
    .select("id, feedback_id, author_id, visibility, body, created_at")
    .single();
}

// ── History ────────────────────────────────────────────────

export async function getHubFeedbackEvents(supabase: Client, feedbackId: string) {
  return supabase
    .from("hub_feedback_events")
    .select("id, feedback_id, actor_id, kind, from_status, to_status, note, created_at")
    .eq("feedback_id", feedbackId)
    .order("created_at");
}

// ── Files ──────────────────────────────────────────────────

export async function getHubFeedbackFiles(supabase: Client, feedbackId: string) {
  return supabase
    .from("hub_feedback_files")
    .select("id, feedback_id, file_path, file_name, content_type, created_at")
    .eq("feedback_id", feedbackId)
    .order("created_at");
}

export async function insertHubFeedbackFile(
  supabase: Client,
  row: { feedback_id: string; file_path: string; file_name: string | null; content_type: string; uploaded_by: string }
) {
  return supabase.from("hub_feedback_files").insert(row).select("id").single();
}

// ── People ─────────────────────────────────────────────────

/**
 * Display names for a set of user ids. Pass the service-role client: the
 * board shows who sent what, and staff can't always read each other's
 * users rows. Only the name leaves this function.
 */
export async function getHubFeedbackPeople(
  admin: Client,
  ids: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return {};
  const { data } = await admin
    .from("users")
    .select("id, first_name, last_name, display_name, email")
    .in("id", unique);
  const out: Record<string, string> = {};
  for (const u of (data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    email: string | null;
  }[]) {
    out[u.id] =
      [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
      u.display_name ||
      u.email ||
      "Someone";
  }
  return out;
}

/**
 * Who a triager can hand an item to: super_admins plus anyone holding a
 * feedback permission directly or through a role. Service-role client.
 */
export async function getHubFeedbackAssignees(admin: Client): Promise<{ id: string; name: string }[]> {
  const { data: perms } = await admin
    .from("permissions")
    .select("id")
    .eq("module", "hub-feedback");
  const permIds = ((perms ?? []) as { id: string }[]).map((p) => p.id);

  const [direct, bundles, supers] = await Promise.all([
    permIds.length
      ? admin.from("user_permissions").select("user_id").in("permission_id", permIds)
      : { data: [] },
    permIds.length
      ? admin.from("role_permissions").select("role_id").in("permission_id", permIds)
      : { data: [] },
    admin.from("user_roles").select("user_id, roles!inner(name)").eq("roles.name", "super_admin"),
  ]);

  const userIds = new Set<string>();
  for (const r of (direct.data ?? []) as { user_id: string }[]) userIds.add(r.user_id);
  for (const r of (supers.data ?? []) as { user_id: string }[]) userIds.add(r.user_id);

  const roleIds = ((bundles.data ?? []) as { role_id: string }[]).map((r) => r.role_id);
  if (roleIds.length) {
    const { data: holders } = await admin.from("user_roles").select("user_id").in("role_id", roleIds);
    for (const r of (holders ?? []) as { user_id: string }[]) userIds.add(r.user_id);
  }

  const names = await getHubFeedbackPeople(admin, [...userIds]);
  return Object.entries(names)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Service-role writes ────────────────────────────────────

/** A merge moves everything already merged into `fromId` onto the new root. */
export async function repointHubFeedbackDuplicates(admin: Client, fromId: string, rootId: string) {
  return admin.from("hub_feedback").update({ duplicate_of: rootId }).eq("duplicate_of", fromId);
}

/** The submitter answered "needs info" — back into the inbox. */
export async function reopenAnsweredHubFeedback(admin: Client, id: string) {
  return admin
    .from("hub_feedback")
    .update({ status: "new", status_note: "Answered the question" })
    .eq("id", id)
    .eq("status", "needs_info");
}

export async function countHubFeedbackFiles(supabase: Client, feedbackId: string) {
  return supabase
    .from("hub_feedback_files")
    .select("id", { count: "exact", head: true })
    .eq("feedback_id", feedbackId);
}
