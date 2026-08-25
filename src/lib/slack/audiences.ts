/**
 * Who a broadcast actually goes to.
 *
 * The first cut of the broadcast engine had exactly one audience —
 * everyone — which turned out to mean all 165 Hub accounts: students,
 * community members, people who have never had a devo set. A prayer
 * room block-out is genuinely "everyone needs to know", but only
 * within the prayer room; DMing the other 100+ is how the bot gets
 * muted.
 *
 * Audiences are still DERIVED, never subscribed: each one is a query
 * over existing membership or permissions, so nobody has to maintain
 * a notification list and it can never drift from who's actually
 * involved.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type AudienceKey = "everyone" | "prayer_room";

/**
 * Resolve an audience to Hub user ids. Returns ids only — the
 * broadcast engine filters for a linked Slack account, applies mutes
 * and excludes the actor.
 */
export async function resolveAudience(
  admin: AdminClient,
  audience: AudienceKey
): Promise<string[]> {
  if (audience === "everyone") return allActiveUserIds(admin);
  if (audience === "prayer_room") return prayerRoomAudience(admin);
  return [];
}

async function allActiveUserIds(admin: AdminClient): Promise<string[]> {
  const { data, error } = await admin
    .from("users")
    .select("id")
    .neq("is_active", false);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((u) => u.id);
}

/**
 * Everyone involved in the prayer room:
 *
 *   • Roster members who are active or on a break. On-break members
 *     are included deliberately — they're still part of the rota and
 *     a relocation usually outlasts their break. Archived members are
 *     not; they've left.
 *   • Anyone holding prayer_room.manage or prayer_room.evaluate, whether
 *     or not they take sets themselves. A coordinator who never leads
 *     a set still needs to know the room moved.
 */
async function prayerRoomAudience(admin: AdminClient): Promise<string[]> {
  const ids = new Set<string>();

  const { data: members, error: membersError } = await admin
    .from("prayer_room_members")
    .select("user_id, status")
    .in("status", ["active", "on_break"]);
  if (membersError) throw membersError;
  for (const m of (members ?? []) as Array<{ user_id: string }>) {
    ids.add(m.user_id);
  }

  const { data: perms, error: permsError } = await admin
    .from("user_permissions")
    .select("user_id, permissions!inner(key)")
    .in("permissions.key", ["prayer_room.manage", "prayer_room.evaluate"]);
  if (permsError) {
    // Don't lose the roster because the permission join failed — the
    // members are the bulk of the audience and the more important half.
    console.error("[slack/audiences] prayer room permission read failed", permsError);
  } else {
    for (const p of (perms ?? []) as Array<{ user_id: string }>) {
      ids.add(p.user_id);
    }
  }

  return Array.from(ids);
}

/** Human label for the admin/preferences copy. */
export const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  everyone: "Everyone in the Hub",
  prayer_room: "Prayer room members, coordinators and evaluators",
};

export type { SupabaseClient };
