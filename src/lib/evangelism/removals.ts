import { createAdminClient } from "@/lib/supabase/admin";
import { listRemovalsSince, recordRemoval } from "@/services/evangelism";

// evangelism_removals is not in migration 293. Hub Data may add it on #508.
// Writes and reads use the service role so they do not depend on a user-JWT
// policy that 293 does not create. A missing table is an empty log.

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

export function isMissingRemovalsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_TABLE.has(code)) return true;
  return (
    typeof message === "string" &&
    /evangelism_removals/i.test(message) &&
    /does not exist|schema cache|undefined_table/i.test(message)
  );
}

/** Insert a tombstone. Never throws. Returns false when the table is absent or the write failed. */
export async function recordRemovalBestEffort(
  testimonyId: string,
  reason: "withheld" | "deleted"
): Promise<boolean> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return false;
  }
  const { error } = await recordRemoval(admin, { testimony_id: testimonyId, reason });
  if (!error) return true;
  if (!isMissingRemovalsTable(error)) {
    console.error("[evangelism] removal log skipped", (error as { code?: string }).code ?? "");
  }
  return false;
}

/** Ids removed after `since`. Empty when the table is missing or there is no cursor. */
export async function listRemovalIds(since: string | null): Promise<string[]> {
  if (!since) return [];
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return [];
  }
  const { data, error } = await listRemovalsSince(admin, since);
  if (error) {
    if (!isMissingRemovalsTable(error)) {
      console.error("[evangelism] removal log unreadable", (error as { code?: string }).code ?? "");
    }
    return [];
  }
  return [
    ...new Set(((data ?? []) as Array<{ testimony_id: string }>).map((row) => row.testimony_id).filter(Boolean)),
  ];
}
