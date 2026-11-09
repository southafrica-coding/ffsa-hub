import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { getApplicationExpiry, passesApplicationExpiry } from "./application-expiry";

const PROGRAM = "11111111-1111-4111-8111-111111111111";

// The school page shows the applicant list when `!expired || canAccess`
// (program-detail.tsx). An RPC error must make that false. Mounting
// ProgramDetail needs the whole school payload, so this locks the fields
// that condition reads.

function client(resolve: Parameters<typeof createFakeSupabase>[0]["resolve"]) {
  return createFakeSupabase({ resolve }).client;
}

describe("passesApplicationExpiry", () => {
  it("allows a live school", async () => {
    const supabase = client((q) => {
      if (q.table === "rpc:program_end_date") return { data: null };
      if (q.table === "rpc:program_applications_expired") return { data: false };
      if (q.table === "rpc:can_access_expired_applications") return { data: false };
      return { data: null };
    });
    expect(await passesApplicationExpiry(supabase, PROGRAM)).toBe(true);
  });

  it("denies an expired school unless the viewer may still open it", async () => {
    const closed = client((q) => {
      if (q.table === "rpc:program_end_date") return { data: "2020-01-01" };
      if (q.table === "rpc:program_applications_expired") return { data: true };
      if (q.table === "rpc:can_access_expired_applications") return { data: false };
      return { data: null };
    });
    expect(await passesApplicationExpiry(closed, PROGRAM)).toBe(false);

    const open = client((q) => {
      if (q.table === "rpc:program_end_date") return { data: "2020-01-01" };
      if (q.table === "rpc:program_applications_expired") return { data: true };
      if (q.table === "rpc:can_access_expired_applications") return { data: true };
      return { data: null };
    });
    expect(await passesApplicationExpiry(open, PROGRAM)).toBe(true);
  });

  it("denies when an expiry RPC errors", async () => {
    const supabase = client((q) => {
      if (q.table === "rpc:program_end_date") return { data: null };
      if (q.table === "rpc:program_applications_expired") {
        return { data: null, error: { message: "down" } };
      }
      if (q.table === "rpc:can_access_expired_applications") return { data: false };
      return { data: null };
    });
    const expiry = await getApplicationExpiry(supabase, PROGRAM);
    expect(expiry.lookupFailed).toBe(true);
    expect(expiry.expired).toBe(true);
    expect(expiry.canAccess).toBe(false);
    expect(!expiry.expired || expiry.canAccess).toBe(false);
    expect(await passesApplicationExpiry(supabase, PROGRAM)).toBe(false);
  });

  it("denies when the expiry lookup throws", async () => {
    const supabase = client((q) => {
      if (q.table.startsWith("rpc:")) throw new Error("down");
      return { data: null };
    });
    const expiry = await getApplicationExpiry(supabase, PROGRAM);
    expect(expiry).toMatchObject({ expired: true, canAccess: false, lookupFailed: true });
    expect(await passesApplicationExpiry(supabase, PROGRAM)).toBe(false);
  });
});
