import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  insertError: null as { code?: string; message?: string } | null,
  listError: null as { code?: string; message?: string } | null,
  inserted: null as Record<string, unknown> | null,
  rows: [] as Array<{ testimony_id: string }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/services/evangelism", () => ({
  recordRemoval: async (_client: unknown, row: Record<string, unknown>) => {
    h.inserted = row;
    return { error: h.insertError };
  },
  listRemovalsSince: async () => ({ data: h.listError ? null : h.rows, error: h.listError }),
}));

import { isMissingRemovalsTable, listRemovalIds, recordRemovalBestEffort } from "./removals";

beforeEach(() => {
  h.insertError = null;
  h.listError = null;
  h.inserted = null;
  h.rows = [{ testimony_id: "t-1" }];
});

describe("evangelism_removals hook", () => {
  it("treats a missing table as absent and any other error as present", () => {
    expect(isMissingRemovalsTable({ code: "42P01", message: 'relation "evangelism_removals" does not exist' })).toBe(true);
    expect(isMissingRemovalsTable({ code: "PGRST205", message: "evangelism_removals schema cache" })).toBe(true);
    expect(isMissingRemovalsTable({ message: 'relation "evangelism_removals" does not exist' })).toBe(true);
    expect(isMissingRemovalsTable({ code: "23502", message: "null value" })).toBe(false);
  });

  it("writes a tombstone when the table accepts the row", async () => {
    expect(await recordRemovalBestEffort("t-1", "deleted")).toBe(true);
    expect(h.inserted).toMatchObject({ testimony_id: "t-1", reason: "deleted" });
    expect(await listRemovalIds("2026-11-01T00:00:00.000Z")).toEqual(["t-1"]);
  });

  it("skips a missing table without throwing", async () => {
    h.insertError = { code: "42P01", message: 'relation "evangelism_removals" does not exist' };
    h.listError = { code: "PGRST205", message: "evangelism_removals" };
    expect(await recordRemovalBestEffort("t-1", "withheld")).toBe(false);
    expect(await listRemovalIds("2026-11-01T00:00:00.000Z")).toEqual([]);
  });
});
