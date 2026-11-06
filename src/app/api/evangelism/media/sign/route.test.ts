import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  access: { view: true, submit: true, publish: false },
  allowed: true,
  signed: [] as string[],
  storageError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/auth/check-evangelism-access", () => ({
  getEvangelismAccess: async () => h.access,
}));
vi.mock("@/lib/rate-limit", () => ({
  getRateLimiter: () => ({
    hit: async () => ({ allowed: h.allowed, remaining: 0, resetAt: new Date(Date.now() + 30_000) }),
  }),
  retryAfterSeconds: () => 30,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          h.signed.push(path);
          if (h.storageError) return { data: null, error: h.storageError };
          return { data: { signedUrl: `https://storage.test/${path}`, token: "t" }, error: null };
        },
      }),
    },
  }),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/evangelism/media/sign", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.user = { id: h.userId };
  h.access = { view: true, submit: true, publish: false };
  h.allowed = true;
  h.signed = [];
  h.storageError = null;
});

describe("POST /api/evangelism/media/sign", () => {
  it("signs a photo under the caller's own prefix", async () => {
    const res = await post({ kind: "photo", content_type: "image/jpeg", size: 2048 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bucket).toBe("evangelism-media");
    expect(body.path).toMatch(new RegExp(`^testimonies/${h.userId}/[0-9a-f-]{36}\\.jpg$`));
    expect(body.signed_url).toContain(body.path);
    expect(h.signed).toEqual([body.path]);
  });

  it("rejects a video that is too large and a file the caller cannot upload", async () => {
    expect((await post({ kind: "video", content_type: "video/mp4", size: 300 * 1024 * 1024 })).status).toBe(400);
    h.access = { view: true, submit: false, publish: false };
    expect((await post({ kind: "photo", content_type: "image/png", size: 100 })).status).toBe(403);
    expect(h.signed).toEqual([]);
  });

  it("rate limits and reports a missing bucket as not switched on", async () => {
    h.allowed = false;
    const limited = await post({ kind: "photo", content_type: "image/png", size: 100 });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");

    h.allowed = true;
    h.storageError = { message: "Bucket not found" };
    const missing = await post({ kind: "photo", content_type: "image/png", size: 100 });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: "evangelism_not_enabled" });
  });
});
