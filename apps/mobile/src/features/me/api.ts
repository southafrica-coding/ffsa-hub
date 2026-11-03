// Me tab data. Reads of the person's OWN users row go straight to Supabase
// (RLS: a user reads only their own row). Every write goes through the
// website's API routes (bearer-aware), never a direct table write.

import { z } from "zod";

import type { ApiFetch, ApiFetchInit } from "@/lib/api";

type SupabaseLike = { from: (table: "users") => any };

// ── Profile fields (name + phone) ──────────────────────────────────────────

export type ProfileFields = { firstName: string; lastName: string; phone: string };

export async function getProfileFields(supabase: SupabaseLike, userId: string): Promise<ProfileFields> {
  const { data, error } = await supabase
    .from("users")
    .select("first_name, last_name, phone")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message ?? "read failed");
  const row = (data ?? {}) as { first_name?: string | null; last_name?: string | null; phone?: string | null };
  return { firstName: row.first_name ?? "", lastName: row.last_name ?? "", phone: row.phone ?? "" };
}

/** PUT /api/profile/update with only the fields the app edits. */
export function updateProfile(apiFetch: ApiFetch, fields: ProfileFields) {
  return apiFetch("/api/profile/update", {
    method: "PUT",
    body: {
      first_name: fields.firstName.trim(),
      last_name: fields.lastName.trim(),
      phone: fields.phone.trim() || null,
    },
  });
}

// ── Notification preferences ───────────────────────────────────────────────

export const prefsSchema = z.object({
  modules: z
    .array(z.object({ key: z.string(), label: z.string(), description: z.string().nullish().transform((v) => v ?? "") }))
    .nullish()
    .transform((v) => v ?? []),
  mutedModules: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

export type Prefs = z.infer<typeof prefsSchema>;

export function getPrefs(apiFetch: ApiFetch, init?: Pick<ApiFetchInit, "signal">) {
  return apiFetch("/api/profile/notification-preferences", { ...init, schema: prefsSchema });
}

export function savePrefs(apiFetch: ApiFetch, mutedModules: string[]) {
  return apiFetch("/api/profile/notification-preferences", { method: "PUT", body: { mutedModules } });
}

/** Toggle one module's mute, keeping order stable. */
export function toggleMuted(muted: string[], key: string, receive: boolean): string[] {
  const without = muted.filter((m) => m !== key);
  return receive ? without : [...without, key];
}
