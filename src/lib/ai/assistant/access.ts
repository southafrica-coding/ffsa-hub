/**
 * Access for the in-app Hub assistant (the chat bubble).
 *
 * Unlike the Slack bot (allowlist + service-role client, everyone sees
 * everything), the bubble acts AS the signed-in user:
 *
 *   1. Tools are only offered for modules the user can open in the Hub
 *      (same roles + permissions that drive the sidebar).
 *   2. Every query runs through the user's own Supabase client, so RLS
 *      applies on top — the assistant can never read a row the user
 *      couldn't read on the page themselves.
 */

import { getSidebarAccess } from "@/lib/sidebar-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AssistantAccess = {
  userId: string;
  roles: string[];
  isAdmin: boolean;
  /** Module ids the user can reach (admins: treated as all). */
  modules: Set<string>;
};

export async function getAssistantAccess(
  supabase: Client,
  userId: string
): Promise<AssistantAccess> {
  const { userRoles, permittedModules } = await getSidebarAccess(supabase);
  const isAdmin = userRoles.includes("super_admin") || userRoles.includes("admin");
  return { userId, roles: userRoles, isAdmin, modules: permittedModules };
}

export function canUseModule(access: AssistantAccess, module: string): boolean {
  return access.isAdmin || access.modules.has(module);
}

/**
 * Is the bubble switched on? Off unless AI_ASSISTANT_ENABLED=true and an
 * API key is configured. Optional AI_ASSISTANT_ROLES (comma list) limits a
 * pilot to certain roles, e.g. "super_admin,admin".
 */
export function assistantEnabledFor(roles: string[]): boolean {
  if (process.env.AI_ASSISTANT_ENABLED !== "true") return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;
  const pilot = (process.env.AI_ASSISTANT_ROLES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (pilot.length === 0) return true;
  return roles.some((r) => pilot.includes(r));
}
