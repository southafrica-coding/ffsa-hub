import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ admin: 0, send: 0 }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    calls.admin += 1;
    const result = { data: [], error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: () => b,
      lte: () => b,
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return { from: () => b };
  },
}));
vi.mock("@/services/campaign-send", () => ({
  sendCampaignBatch: async () => {
    calls.send += 1;
    return { ok: true, sent: 0, failed: 0, remaining: 0, done: true };
  },
}));

import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://x/api/cron/send-scheduled", {
      headers: authorization ? { authorization } : {},
    })
  );

describe("GET /api/cron/send-scheduled", () => {
  beforeEach(() => {
    calls.admin = 0;
    calls.send = 0;
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to run when CRON_SECRET is missing or blank", async () => {
    vi.stubEnv("CRON_SECRET", "   ");
    const blank = await call("Bearer cron-test-secret");
    expect(blank.status).toBe(503);
    expect((await blank.json()).error).toBe("cron secret not configured");

    vi.unstubAllEnvs();
    delete process.env.CRON_SECRET;
    expect((await call("Bearer cron-test-secret")).status).toBe(503);
    expect(calls.admin).toBe(0);
    expect(calls.send).toBe(0);
  });

  it("401 when the bearer does not match, and does not send", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(calls.admin).toBe(0);
    expect(calls.send).toBe(0);
  });

  it("runs only with the matching bearer", async () => {
    const res = await call("Bearer cron-test-secret");
    expect(res.status).toBe(200);
    expect(calls.admin).toBe(1);
    expect(calls.send).toBe(0);
  });
});