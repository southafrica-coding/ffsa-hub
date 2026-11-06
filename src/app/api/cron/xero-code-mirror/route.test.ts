import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/finance/xero-mirror-sync", () => ({
  syncXeroMirror: async (db: unknown, opts: Record<string, unknown>) => {
    calls.push({ db, ...opts });
    return [{ region: "za", status: "succeeded" }, { region: "us", status: "skipped", error: "not connected" }];
  },
}));

import { GET } from "./route";

describe("GET /api/cron/xero-code-mirror", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    calls.length = 0;
  });

  it("401 without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(new Request("http://x", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("syncs both regions with the service role", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(new Request("http://x", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ db: { admin: true }, trigger: "cron" }]);
  });

  it("is registered in vercel.json as a daily cron (Hobby plan)", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = JSON.parse(readFileSync(new URL("../../../../../vercel.json", import.meta.url), "utf8"));
    const job = cfg.crons.find((c: { path: string }) => c.path === "/api/cron/xero-code-mirror");
    expect(job?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});
