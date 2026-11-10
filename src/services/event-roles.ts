import type { TablesInsert, TablesUpdate } from "@/types/database";

type RoleInsert = TablesInsert<"event_roles">;
type RoleUpdate = TablesUpdate<"event_roles">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Event roles (roster)
// ────────────────────────────────────────────────────────────

export async function getEventRoles(supabase: Client, eventId: string) {
  return supabase
    .from("event_roles")
    .select(
      "*, users:user_id(id, first_name, last_name, email), contacts:contact_id(id, first_name, last_name, email)"
    )
    .eq("event_id", eventId)
    .order("sort_order")
    .order("created_at");
}

export async function createEventRole(supabase: Client, data: RoleInsert) {
  return supabase.from("event_roles").insert(data).select().single();
}

export async function updateEventRole(
  supabase: Client,
  id: string,
  data: RoleUpdate
) {
  return supabase.from("event_roles").update(data).eq("id", id).select().single();
}

export async function deleteEventRole(supabase: Client, id: string) {
  return supabase.from("event_roles").delete().eq("id", id).select("id");
}
