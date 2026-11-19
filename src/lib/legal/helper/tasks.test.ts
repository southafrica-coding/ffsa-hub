import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

// A plain stand-in for the helper loop: each test sets what it does.
type Impl = (a: { onTurn?: (n: string[]) => Promise<boolean | void> }) => Promise<unknown>;
const h = vi.hoisted(() => ({ impl: null as null | Impl, calls: [] as unknown[] }));
vi.mock("./run", () => ({
  runLegalHelper: (a: never) => {
    h.calls.push(a);
    return h.impl!(a);
  },
  progressFor: () => "Working",
}));

import { runTask } from "./tasks";
import { QUEUE_WAIT_MS, STALE_MS, canRerun, runningLimitProblem, taskLimitProblem, taskState } from "./task-state";
import { START_TASK_TOOL } from "./tools";

const NOW = Date.parse("2026-11-18T20:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("taskState", () => {
  it("queued: starting, then not started after a minute", () => {
    expect(taskState({ status: "queued", heartbeat_at: null, created_at: ago(5_000) }, NOW)).toBe("waiting");
    expect(taskState({ status: "queued", heartbeat_at: null, created_at: ago(QUEUE_WAIT_MS + 1) }, NOW)).toBe("not_started");
  });
  it("running: working while the heartbeat is fresh, stopped after six minutes without one", () => {
    expect(taskState({ status: "running", heartbeat_at: ago(30_000), created_at: ago(60_000) }, NOW)).toBe("working");
    expect(taskState({ status: "running", heartbeat_at: ago(STALE_MS + 1), created_at: ago(STALE_MS * 2) }, NOW)).toBe("stalled");
  });
  it("only stopped, failed, cancelled or never-started tasks can run again", () => {
    expect(["not_started", "stalled", "failed", "cancelled"].every((s) => canRerun(s as never))).toBe(true);
    expect(["waiting", "working", "done"].some((s) => canRerun(s as never))).toBe(false);
  });
});

describe("spending guard", () => {
  const t = (status: string, msAgo: number, beatAgo: number | null = null) => ({
    status: status as never,
    created_at: ago(msAgo),
    heartbeat_at: beatAgo === null ? null : ago(beatAgo),
  });
  it("two working at once is the most", () => {
    expect(runningLimitProblem([t("running", 60_000, 10_000)], NOW)).toBeNull();
    expect(runningLimitProblem([t("running", 60_000, 10_000), t("queued", 5_000)], NOW)).toMatch(/already working/);
    // a stopped one doesn't hold a slot
    expect(runningLimitProblem([t("running", 60_000, 10_000), t("running", 3_600_000, STALE_MS + 1)], NOW)).toBeNull();
  });
  it("fifteen a day", () => {
    const fourteen = Array.from({ length: 14 }, () => t("done", 3_600_000));
    expect(taskLimitProblem(fourteen, NOW)).toBeNull();
    expect(taskLimitProblem([...fourteen, t("done", 60_000)], NOW)).toMatch(/limit/);
  });
});

describe("the hand-off tool", () => {
  it("is strict, like the rest", () => {
    expect(START_TASK_TOOL.strict).toBe(true);
    const schema = START_TASK_TOOL.input_schema as unknown as { required: string[]; properties: object; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
  });
});

describe("runTask", () => {
  const ID = "77777777-7777-4777-8777-777777777777";
  const updates = (qs: FakeQuery[]) => qs.filter((q) => q.action === "update");
  const args = (client: unknown) => ({ supabase: client, userId: "u1", userName: "Sample", isOwner: true, taskId: ID });

  beforeEach(() => {
    h.impl = null;
    h.calls = [];
  });

  function client(opts: { claimed: boolean; statusAfterTurn?: string }) {
    return createFakeSupabase({
      user: { id: "u1" },
      resolve: (q) => {
        if (q.action !== "update") return { data: null };
        const conditional = q.filters.some((f) => f.op === "eq" && f.args[0] === "status");
        if (conditional) return { data: opts.claimed ? { id: ID, request: "Prepare the PBO pack", attempts: 0 } : null };
        return { data: { status: opts.statusAfterTurn ?? "running" } };
      },
    });
  }

  it("does nothing when another run already claimed it", async () => {
    const f = client({ claimed: false });
    await runTask(args(f.client) as never);
    expect(h.calls).toHaveLength(0);
    expect(updates(f.queries)).toHaveLength(1); // the claim attempt only
  });

  it("claims it, works in task mode as the asker, and records the result", async () => {
    h.impl = async () => ({ answer: "Saved 2 drafts.", drafts: [{ id: "d1" }, { id: "d2" }], tasks: [], stopped: null, inputTokens: 1, outputTokens: 1 });
    const f = client({ claimed: true });
    await runTask(args(f.client) as never);
    expect(h.calls[0]).toEqual(
      expect.objectContaining({ mode: "task", userId: "u1", messages: [{ role: "user", content: "Prepare the PBO pack" }] })
    );
    // claim, attempts, final result
    expect(updates(f.queries)).toHaveLength(3);
  });

  it("stops between steps once it is cancelled", async () => {
    h.impl = async ({ onTurn }) => {
      const stop = await onTurn!(["read_scan"]);
      return { answer: "", drafts: [], tasks: [], stopped: stop ? "cancelled" : null, inputTokens: 0, outputTokens: 0 };
    };
    const f = client({ claimed: true, statusAfterTurn: "cancelled" });
    await runTask(args(f.client) as never);
    // claim, attempts, heartbeat — and no final "done" over the cancellation
    expect(updates(f.queries)).toHaveLength(3);
  });

  it("marks it failed if the work throws", async () => {
    h.impl = async () => {
      throw new Error("boom");
    };
    const f = client({ claimed: true });
    await runTask(args(f.client) as never);
    expect(updates(f.queries)).toHaveLength(3);
  });
});
