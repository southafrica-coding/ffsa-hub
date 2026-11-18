/**
 * FFSA platform roles live on `user_roles` and come back from GET /api/me.
 * They are not Missio org roles. Null means the read failed.
 */
export async function readFfsaRoleNames(
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  try {
    const res = await fetchImpl("/api/me", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { roles?: unknown };
    if (!Array.isArray(body.roles)) return null;
    const names: string[] = [];
    for (const role of body.roles) {
      if (!role || typeof role !== "object" || !("name" in role)) continue;
      const name = (role as { name?: unknown }).name;
      if (typeof name !== "string") continue;
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
    return names;
  } catch {
    return null;
  }
}

let cached: Promise<string[] | null> | null = null;

export function clearFfsaRoleCache() {
  cached = null;
}

export function loadFfsaRoleNames(): Promise<string[] | null> {
  if (!cached) cached = readFfsaRoleNames();
  return cached;
}
