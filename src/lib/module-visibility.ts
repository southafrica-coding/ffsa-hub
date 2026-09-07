/**
 * Module visibility — hide a module from the Hub while it is being tested.
 *
 * Backed by public.module_visibility (migration 207), keyed on the module ids
 * in src/config/modules.ts. Three states:
 *
 *   live    normal — the existing role/permission rules decide who sees it
 *   beta    super admins ONLY (not plain `admin`), in the nav and on the route
 *   hidden  nobody, super admins included — a kill switch
 *
 * FAIL-OPEN BY DESIGN. If the read fails we treat every module as `live`.
 * A momentary DB blip must never blank the Hub for everyone — that is exactly
 * the "Luke can't see anything" false alarm that src/lib/sidebar-access.ts is
 * already hardened against, and it would be far worse here because this table
 * gates every module at once. The cost of failing open is that a beta module
 * could briefly be visible; the cost of failing closed is the whole Hub going
 * dark. Anything genuinely secret belongs behind a permission, not behind this.
 */

export type ModuleVisibility = "live" | "beta" | "hidden";

/** Module id → visibility. A missing entry means `live`. */
export type ModuleVisibilityMap = Map<string, ModuleVisibility>;

export interface ModuleVisibilityRow {
  key: string;
  visibility: ModuleVisibility;
  note: string | null;
}

const VALID: ModuleVisibility[] = ["live", "beta", "hidden"];

/**
 * Read the visibility map. Never throws and never returns null — on any error
 * it returns an empty map, which reads as "everything is live".
 */
export async function getModuleVisibility(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<ModuleVisibilityMap> {
  const map: ModuleVisibilityMap = new Map();
  try {
    const { data, error } = await supabase
      .from("module_visibility")
      .select("key, visibility");
    if (error || !data) return map; // fail open
    for (const row of data as { key: string; visibility: string }[]) {
      if (VALID.includes(row.visibility as ModuleVisibility)) {
        map.set(row.key, row.visibility as ModuleVisibility);
      }
    }
  } catch {
    return map; // fail open
  }
  return map;
}

/** Full rows including notes — for the super-admin settings page. */
export async function getModuleVisibilityRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<ModuleVisibilityRow[]> {
  const { data } = await supabase
    .from("module_visibility")
    .select("key, visibility, note");
  return (data ?? []) as ModuleVisibilityRow[];
}

/** Resolve one module's state, defaulting to `live`. */
export function visibilityOf(
  moduleId: string,
  visibility?: ModuleVisibilityMap
): ModuleVisibility {
  return visibility?.get(moduleId) ?? "live";
}

/**
 * Can this user reach the module AT ALL, ignoring their roles/permissions?
 * This is only the rollout gate — the caller still applies the normal
 * role/permission checks on top for a `live` module.
 */
export function passesVisibilityGate(
  moduleId: string,
  userRoles: string[],
  visibility?: ModuleVisibilityMap
): boolean {
  const state = visibilityOf(moduleId, visibility);
  if (state === "live") return true;
  if (state === "hidden") return false;
  // beta — super_admin only. Deliberately NOT plain `admin`: the point is a
  // module that only the people building it can see.
  return userRoles.includes("super_admin");
}
