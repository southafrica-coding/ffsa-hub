// Org import review — the 099 drawing waiting for a person to say who each
// name is (migration 250). The queue and the org tables postdate the
// generated database.ts, so this uses the project's `Client = any` pattern.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ImportProposal = "membership" | "oversees" | "integrates" | "alongside";
export type ImportMatch = "exact" | "first_name" | "ambiguous" | "none";
export type ImportStatus = "open" | "applied" | "already_true" | "dismissed";

export type ImportRow = {
  id: string;
  source_kind: "person" | "edge" | "role";
  chart_label: string;
  role_title: string | null;
  chart_group: string | null;
  staff_ministry_id: string | null;
  proposal: ImportProposal;
  match_kind: ImportMatch;
  suggested_user_ids: string[];
  status: ImportStatus;
  resolved_user_id: string | null;
  resolved_proposal: ImportProposal | null;
  resolved_ministry_id: string | null;
  resolved_at: string | null;
  note: string | null;
  sort_order: number;
};

export type ImportPerson = { id: string; name: string; email: string | null };
export type ImportMinistry = { id: string; name: string; cluster: string | null };

const ROW_FIELDS =
  "id, source_kind, chart_label, role_title, chart_group, staff_ministry_id, proposal, match_kind, suggested_user_ids, status, resolved_user_id, resolved_proposal, resolved_ministry_id, resolved_at, note, sort_order";

export function personName(u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  display_name: string | null;
  email: string | null;
}): string {
  const first = u.preferred_name || u.first_name;
  const full = [first, u.last_name].filter(Boolean).join(" ").trim();
  return full || u.display_name || u.email || "Unnamed";
}

/** Whether the signed-in user may resolve the queue: admin or org.manage. */
export async function canManageOrg(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_org_chart_manage");
  return !error && data === true;
}

/**
 * Everything the review screen needs. `admin` is the service-role client —
 * call only after canManageOrg(), the same authorize-then-read pattern the
 * ministries routes use. Users are read in full (one page: the Hub has a few
 * hundred) because a chart name with no suggestion still needs a picker.
 */
export async function loadImportReview(admin: Client) {
  const [rows, users, ministries] = await Promise.all([
    admin.from("org_import_queue").select(ROW_FIELDS).order("sort_order"),
    admin
      .from("users")
      .select("id, first_name, last_name, preferred_name, display_name, email")
      .is("merged_into_user_id", null)
      .limit(1000),
    admin
      .from("staff_ministries")
      .select("id, name, cluster, is_active")
      .order("sort_order")
      .order("name"),
  ]);

  const error = rows.error ?? users.error ?? ministries.error;
  if (error) return { error: error.message as string };

  const people: ImportPerson[] = (users.data ?? [])
    .map((u: Parameters<typeof personName>[0] & { id: string }) => ({
      id: u.id,
      name: personName(u),
      email: u.email,
    }))
    .sort((a: ImportPerson, b: ImportPerson) => a.name.localeCompare(b.name));

  return {
    rows: (rows.data ?? []) as ImportRow[],
    people,
    ministries: ((ministries.data ?? []) as (ImportMinistry & { is_active: boolean })[])
      .filter((m) => m.is_active)
      .map(({ id, name, cluster }) => ({ id, name, cluster })),
  };
}
