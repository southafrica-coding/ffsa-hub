// Admin-editable dropdown vocabularies (departments, insurance providers,
// gender, relationship, …). Backed by the public.list_options table
// (migration 136). The hard-coded arrays in src/lib/profile/options.ts remain
// as the seed source and as a runtime fallback.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ListOption = {
  id: string;
  list_key: string;
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
};

export const LIST_KEYS = [
  "department",
  "insurance_provider",
  "gender",
  "relationship",
] as const;
export type ListKey = (typeof LIST_KEYS)[number];

// Options for a single list, in display order.
export async function getListOptions(
  supabase: Client,
  key: string,
  opts?: { activeOnly?: boolean }
) {
  let query = supabase
    .from("list_options")
    .select("*")
    .eq("list_key", key)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (opts?.activeOnly) query = query.eq("is_active", true);
  return query;
}

// Every list, grouped by list_key. Used by the Settings page and the
// public read endpoint.
export async function getAllListOptions(supabase: Client) {
  const { data, error } = await supabase
    .from("list_options")
    .select("*")
    .order("list_key", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) return { data: null, error };
  const grouped: Record<string, ListOption[]> = {};
  for (const row of (data ?? []) as ListOption[]) {
    (grouped[row.list_key] ??= []).push(row);
  }
  return { data: grouped, error: null };
}

export async function createOption(
  supabase: Client,
  input: { list_key: string; value: string; label: string; sort_order?: number }
) {
  return supabase
    .from("list_options")
    .insert({
      list_key: input.list_key,
      value: input.value,
      label: input.label,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single();
}

export async function updateOption(
  supabase: Client,
  id: string,
  data: Partial<Pick<ListOption, "label" | "sort_order" | "is_active">>
) {
  return supabase
    .from("list_options")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

// Hard delete — the API layer blocks this for is_system rows.
export async function deleteOption(supabase: Client, id: string) {
  return supabase.from("list_options").delete().eq("id", id);
}
