// ────────────────────────────────────────────────────────────
// Dashboard — data access
// ────────────────────────────────────────────────────────────
// Per-user dashboard layout preferences. Resolution against the widget
// registry (defaults, permission gates, merging) lives in
// `src/lib/dashboard/widget-registry.ts` — this file is queries only.
// ────────────────────────────────────────────────────────────

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

import type { LayoutEntry } from "@/lib/dashboard/widget-registry";

export async function getStoredLayout(supabase: Client, userId: string) {
  return supabase
    .from("dashboard_layouts")
    .select("layout")
    .eq("user_id", userId)
    .maybeSingle();
}

export async function upsertLayout(
  supabase: Client,
  userId: string,
  layout: LayoutEntry[]
) {
  return supabase
    .from("dashboard_layouts")
    .upsert(
      { user_id: userId, layout, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
    .select("layout")
    .single();
}

// Reset to registry defaults. Deleting the row IS the reset — we never seed
// this table, so "no row" means "defaults".
export async function deleteLayout(supabase: Client, userId: string) {
  return supabase.from("dashboard_layouts").delete().eq("user_id", userId);
}
