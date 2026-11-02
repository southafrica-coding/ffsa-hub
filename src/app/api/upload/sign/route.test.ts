import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/upload/sign stays anonymous (applicants on /apply have no
// account) but only signs the form's own path shape, and is rate limited.

const state = vi.hoisted(() => ({
  signed: [] as string[],
  allowed: true,
  limiterKeys: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          state.signed.push(path);
          return { data: { signedUrl: `https://storage.test/${path}?token=t`, token: "t" }, error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    getRateLimiter: () => ({
      hit: async (key: string) => {
        state.limiterKeys.push(key);
        return { allowed: state.allowed, remaining: 0, resetAt: new Date(Date.now() + 30_000) };
      },
    }),
  };
});

import { POST } from "./route";

const UUID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";
const GOOD = `applications/draft/7e8f9a0b-1111-4222-8333-444455556666/${UUID}-photo.jpg`;

const post = (body: unknown, ip = "203.0.113.9") =>
  POST(
    new Request("https://hub.test/api/upload/sign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

beforeEach(() => {
  state.signed.length = 0;
  state.limiterKeys.length = 0;
  state.allowed = true;
});

describe("POST /api/upload/sign", () => {
  it("signs a valid applicant upload with no session", async () => {
    const res = await post({ bucket: "application-uploads", path: GOOD, contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: "t" });
    expect(state.signed).toEqual([GOOD]);
  });

  it("is rate limited per client IP", async () => {
    await post({ bucket: "application-uploads", path: GOOD, contentType: "image/jpeg" });
    expect(state.limiterKeys).toEqual(["upload-sign:203.0.113.9"]);

    state.allowed = false;
    const res = await post({ bucket: "application-uploads", path: GOOD, contentType: "image/jpeg" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(state.signed).toHaveLength(1);
  });

  it.each([
    ["wrong bucket", { bucket: "avatars", path: GOOD, contentType: "image/jpeg" }],
    ["traversal", { bucket: "application-uploads", path: `applications/../x/${UUID}-a.jpg`, contentType: "image/jpeg" }],
    ["old loose prefix check", { bucket: "application-uploads", path: "applications/anything/at/all.jpg", contentType: "image/jpeg" }],
    ["svg content type", { bucket: "application-uploads", path: GOOD, contentType: "image/svg+xml" }],
    ["html content type", { bucket: "application-uploads", path: GOOD, contentType: "text/html" }],
    ["no path", { bucket: "application-uploads", contentType: "image/jpeg" }],
  ])("400 and nothing signed: %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(state.signed).toHaveLength(0);
  });

  it("400 on a body that isn't JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("an empty content type is still fine (some phones send none)", async () => {
    const res = await post({ bucket: "application-uploads", path: GOOD, contentType: "" });
    expect(res.status).toBe(200);
  });
});
