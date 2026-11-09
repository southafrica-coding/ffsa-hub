import { describe, expect, it } from "vitest";
import { advanceApplicationWhenReferencesComplete } from "./advance-reference-stage";

type App = { id: string; program_id: string; status: string };

function clientFor(state: {
  app: App | null;
  slots: Array<{ id: string; is_required: boolean }>;
  refs: Array<{ slot_id: string; status: string }>;
  /** False when the guarded update matches no row. */
  matched?: boolean;
}) {
  const updates: Array<{ status: string; id: string; guard: string[] }> = [];

  function builder(table: string) {
    const filters: Array<{ op: string; args: unknown[] }> = [];
    const api = {
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push({ op: "eq", args: [column, value] });
        return api;
      },
      in(column: string, value: unknown) {
        filters.push({ op: "in", args: [column, value] });
        if (table === "application_responses" && updates.length > 0 && !updates.at(-1)?.guard.length) {
          updates.at(-1)!.guard = value as string[];
          updates.at(-1)!.id = String(filters.find((f) => f.op === "eq")?.args[1] ?? "");
        }
        const matched = state.matched !== false;
        return Promise.resolve({
          data: matched && state.app ? [{ id: state.app.id }] : [],
          error: null,
        });
      },
      maybeSingle: async () => {
        if (table !== "application_responses") return { data: null, error: null };
        return { data: state.app, error: null };
      },
      update(patch: { status: string }) {
        updates.push({ status: patch.status, id: "", guard: [] });
        return api;
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
        const payload =
          table === "reference_slots"
            ? { data: state.slots, error: null }
            : table === "reference_requests"
              ? { data: state.refs, error: null }
              : { data: null, error: null };
        return Promise.resolve(payload).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { client: { from: builder }, updates };
}

const bothIn = [
  { slot_id: "friend", status: "submitted" },
  { slot_id: "leader", status: "submitted" },
];
const slots = [
  { id: "friend", is_required: true },
  { id: "leader", is_required: true },
];

describe("advanceApplicationWhenReferencesComplete", () => {
  it("moves waiting_for_references to references_received when both required refs are in", async () => {
    const db = clientFor({
      app: { id: "maggie", program_id: "sbi", status: "waiting_for_references" },
      slots,
      refs: bothIn,
    });
    const result = await advanceApplicationWhenReferencesComplete(db.client, "maggie");
    expect(result).toEqual({ advanced: true });
    expect(db.updates).toEqual([
      {
        status: "references_received",
        id: "maggie",
        guard: ["submitted", "waiting_for_references"],
      },
    ]);
  });

  it("moves a stored submitted application the same way", async () => {
    const db = clientFor({
      app: { id: "hedrik", program_id: "sbi", status: "submitted" },
      slots,
      refs: bothIn,
    });
    expect(await advanceApplicationWhenReferencesComplete(db.client, "hedrik")).toEqual({
      advanced: true,
    });
  });

  it("does not write when a required ref is still pending", async () => {
    const db = clientFor({
      app: { id: "kerri", program_id: "sbi", status: "waiting_for_references" },
      slots,
      refs: [
        { slot_id: "friend", status: "submitted" },
        { slot_id: "leader", status: "pending" },
      ],
    });
    expect(await advanceApplicationWhenReferencesComplete(db.client, "kerri")).toEqual({
      advanced: false,
    });
    expect(db.updates).toEqual([]);
  });

  it("returns advanced false when the guarded update matches no row", async () => {
    const db = clientFor({
      app: { id: "maggie", program_id: "sbi", status: "submitted" },
      slots,
      refs: bothIn,
      matched: false,
    });
    expect(await advanceApplicationWhenReferencesComplete(db.client, "maggie")).toEqual({
      advanced: false,
    });
  });

  it("does not move interview_scheduled or a decision", async () => {
    for (const status of ["interview_scheduled", "accepted", "rejected"]) {
      const db = clientFor({
        app: { id: "later", program_id: "sbi", status },
        slots,
        refs: bothIn,
      });
      expect(await advanceApplicationWhenReferencesComplete(db.client, "later")).toEqual({
        advanced: false,
      });
      expect(db.updates).toEqual([]);
    }
  });
});
