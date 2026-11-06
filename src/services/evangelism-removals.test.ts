import { describe, expect, it } from "vitest";
import { listRemovalsSince, recordRemoval } from "./evangelism";

function removalClient(outcome: { error: { code?: string } | null }) {
  const calls: Array<{ op: string; row?: unknown; onConflict?: string }> = [];
  let reads = 0;
  const chain = {
    upsert(row: unknown, options: { onConflict?: string }) {
      calls.push({ op: "upsert", row, onConflict: options.onConflict });
      return chain;
    },
    insert(row: unknown) {
      calls.push({ op: "insert", row });
      return chain;
    },
    update(row: unknown) {
      calls.push({ op: "update", row });
      return chain;
    },
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    gt() {
      return chain;
    },
    limit() {
      return chain;
    },
    maybeSingle: async () => {
      reads += 1;
      if (reads === 1) return { data: null, error: outcome.error };
      return { data: { testimony_id: "t-1" }, error: null };
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
      return Promise.resolve({
        data: [
          { testimony_id: "t-1" },
          { testimony_id: "t-1" },
          { testimony_id: "t-2" },
        ],
        error: null,
      }).then(onFulfilled, onRejected);
    },
  };
  return { calls, client: { from: () => chain } };
}

describe("recordRemoval", () => {
  it("upserts on testimony_id so a second write updates the same row", async () => {
    const db = removalClient({ error: null });
    const { error } = await recordRemoval(db.client, { testimony_id: "t-1", reason: "deleted" });
    expect(error).toBeNull();
    expect(db.calls[0]).toMatchObject({ op: "upsert", onConflict: "testimony_id" });
    expect(db.calls[0].row).toMatchObject({ testimony_id: "t-1", reason: "deleted" });
    expect(db.calls[0].row).toHaveProperty("removed_at");
  });

  it("updates the existing row when the unique constraint reports a conflict", async () => {
    const db = removalClient({ error: { code: "23505" } });
    const { error } = await recordRemoval(db.client, { testimony_id: "t-1", reason: "withheld" });
    expect(error).toBeNull();
    expect(db.calls.map((call) => call.op)).toEqual(["upsert", "update"]);
    expect(db.calls[1].row).toMatchObject({ reason: "withheld" });
  });
});

describe("listRemovalsSince", () => {
  it("returns each testimony id once", async () => {
    const db = removalClient({ error: null });
    const { data, error } = await listRemovalsSince(db.client, "2026-11-01T00:00:00.000Z");
    expect(error).toBeNull();
    expect(data?.map((row: { testimony_id: string }) => row.testimony_id)).toEqual(["t-1", "t-2"]);
  });
});
