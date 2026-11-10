import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  APPLICATIONS_EXPIRED_MESSAGE,
  APPLICATIONS_STATUS_UNKNOWN_MESSAGE,
} from "@/lib/auth/application-expiry";

const PROGRAM = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({ mode: "error" as "error" | "expired" }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    createFakeSupabase({
      user: { id: "me" },
      resolve: (q) => {
        if (q.table === "rpc:program_end_date") return { data: "2020-01-01" };
        if (q.table === "rpc:program_applications_expired") {
          if (h.mode === "error") return { data: null, error: { message: "down" } };
          return { data: true };
        }
        if (q.table === "rpc:can_access_expired_applications") return { data: false };
        return { data: null };
      },
    }).client,
}));

const route = await import("./route");

beforeEach(() => {
  h.mode = "error";
});

function get() {
  return route.GET(new Request(`http://x/api/schools/applications/export?program_id=${PROGRAM}`));
}

describe("GET /api/schools/applications/export expiry", () => {
  it("denies a lookup failure with the status-unknown message and no date", async () => {
    const res = await get();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: APPLICATIONS_STATUS_UNKNOWN_MESSAGE });
    expect(body.error).not.toContain("2020");
  });

  it("denies a real expiry with the archived message", async () => {
    h.mode = "expired";
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: APPLICATIONS_EXPIRED_MESSAGE });
  });
});
