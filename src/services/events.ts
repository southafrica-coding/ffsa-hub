import type { Database, TablesInsert, TablesUpdate } from "@/types/database";
type EventInsert = TablesInsert<"events">;
type EventUpdate = TablesUpdate<"events">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// Lifecycle groupings. "Closed out" events are done with — they're gone
// from the public site and hidden from the default Events list, but never
// deleted.
export const OPEN_EVENT_STATUSES = ["draft", "published"] as const;
export const CLOSED_EVENT_STATUSES = ["completed", "cancelled"] as const;

export function isClosedEventStatus(status: string) {
  return (CLOSED_EVENT_STATUSES as readonly string[]).includes(status);
}

export async function getEvents(
  supabase: Client,
  options?: {
    status?: string;
    statuses?: readonly string[];
    search?: string;
    upcoming?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  let query = supabase
    .from("events")
    .select("*", { count: "exact" })
    .order("start_date", { ascending: true });

  if (options?.status) {
    query = query.eq("status", options.status);
  } else if (options?.statuses?.length) {
    query = query.in("status", options.statuses);
  }

  if (options?.search) {
    const term = `%${options.search}%`;
    query = query.or(`title.ilike.${term},description.ilike.${term},location.ilike.${term}`);
  }

  if (options?.upcoming) {
    query = query
      .gte("start_date", new Date().toISOString().split("T")[0])
      .eq("status", "published");
  }

  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  return query;
}

export async function getEventById(supabase: Client, id: string) {
  return supabase.from("events").select("*").eq("id", id).single();
}

export async function getEventBySlug(supabase: Client, slug: string) {
  return supabase
    .from("events")
    .select("*")
    .eq("public_slug", slug)
    .maybeSingle();
}

export async function createEvent(supabase: Client, data: EventInsert) {
  return supabase.from("events").insert(data).select().single();
}

export async function updateEvent(
  supabase: Client,
  id: string,
  data: EventUpdate
) {
  return supabase.from("events").update(data).eq("id", id).select().single();
}

export async function publishEvent(supabase: Client, id: string) {
  return updateEvent(supabase, id, { status: "published" });
}

export async function cancelEvent(supabase: Client, id: string) {
  return updateEvent(supabase, id, { status: "cancelled" });
}

export async function completeEvent(supabase: Client, id: string) {
  return updateEvent(supabase, id, { status: "completed" });
}
