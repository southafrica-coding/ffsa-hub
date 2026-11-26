// Operations → the guide: data access (migration 404).
// RLS decides: everyone in Operations reads; only the area's lead writes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ── Who ─────────────────────────────────────────────────────

/** Mirrors public.is_ops_area_lead(area) — admins and holders of the area's lead permission. */
export async function isAreaLead(supabase: Client, area: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_ops_area_lead", { area });
  return !error && data === true;
}

// ── How we do it ────────────────────────────────────────────

export async function listPages(supabase: Client, area: string) {
  return supabase
    .from("ops_guide_pages")
    .select("id, area, title, sort, updated_at")
    .eq("area", area)
    .order("sort")
    .order("created_at");
}

export async function getPage(supabase: Client, id: string) {
  return supabase
    .from("ops_guide_pages")
    .select("*, editor:users!ops_guide_pages_updated_by_fkey(display_name)")
    .eq("id", id)
    .maybeSingle();
}

export async function createPage(supabase: Client, row: { area: string; title: string; body: string; sort?: number }) {
  return supabase.from("ops_guide_pages").insert(row).select("id").single();
}

export async function updatePage(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("ops_guide_pages").update(patch).eq("id", id).select("id, area").maybeSingle();
}

export async function deletePage(supabase: Client, id: string) {
  return supabase.from("ops_guide_pages").delete().eq("id", id).select("id").maybeSingle();
}

export async function listVersions(supabase: Client, pageId: string) {
  return supabase
    .from("ops_guide_page_versions")
    .select("id, title, body, edited_at, by:users!ops_guide_page_versions_edited_by_fkey(display_name)")
    .eq("page_id", pageId)
    .order("edited_at", { ascending: false })
    .limit(50);
}

// ── Resources ───────────────────────────────────────────────

export async function listLinks(supabase: Client, area: string) {
  return supabase.from("ops_guide_links").select("*").eq("area", area).order("sort").order("created_at");
}

export async function createLink(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("ops_guide_links").insert(row).select("id").single();
}

export async function updateLink(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("ops_guide_links").update(patch).eq("id", id).select("id").maybeSingle();
}

export async function deleteLink(supabase: Client, id: string) {
  return supabase.from("ops_guide_links").delete().eq("id", id).select("id").maybeSingle();
}
