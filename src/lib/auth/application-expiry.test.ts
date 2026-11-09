import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  APPLICATIONS_EXPIRED_MESSAGE,
  APPLICATIONS_STATUS_UNKNOWN_MESSAGE,
  applicationExpiryDenial,
  getApplicationExpiry,
  passesApplicationExpiry,
  userCanReadApplication,
} from "./application-expiry";

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
      if (q.table === "rpc:program_end_date") return { data: "2020-01-01" };
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
    expect(expiry.endDate).toBeNull();
    expect(expiry.expiresOn).toBeNull();
    expect(APPLICATIONS_STATUS_UNKNOWN_MESSAGE).not.toMatch(/\d{4}/);
    expect(await applicationExpiryDenial(supabase, PROGRAM)).toBe(
      APPLICATIONS_STATUS_UNKNOWN_MESSAGE
    );
    expect(await passesApplicationExpiry(supabase, PROGRAM)).toBe(false);
  });

  it("keeps the archived message and the end date for a real expiry", async () => {
    const supabase = client((q) => {
      if (q.table === "rpc:program_end_date") return { data: "2020-01-01" };
      if (q.table === "rpc:program_applications_expired") return { data: true };
      if (q.table === "rpc:can_access_expired_applications") return { data: false };
      return { data: null };
    });
    const expiry = await getApplicationExpiry(supabase, PROGRAM);
    expect(expiry.lookupFailed).toBe(false);
    expect(expiry.expiresOn).toBe("2020-07-01");
    expect(await applicationExpiryDenial(supabase, PROGRAM)).toBe(APPLICATIONS_EXPIRED_MESSAGE);
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

describe("userCanReadApplication", () => {
  it("returns false when the query returns an error", async () => {
    const supabase = client((q) => {
      if (q.table === "application_responses") {
        return { data: [{ id: "app" }], error: { message: "boom" } };
      }
      return { data: null };
    });
    expect(await userCanReadApplication(supabase, "app")).toBe(false);
  });

  it("returns false when the query returns no row", async () => {
    const supabase = client((q) => {
      if (q.table === "application_responses") return { data: null };
      return { data: null };
    });
    expect(await userCanReadApplication(supabase, "app")).toBe(false);
  });

  it("returns false when the query throws", async () => {
    const supabase = client((q) => {
      if (q.table === "application_responses") throw new Error("boom");
      return { data: null };
    });
    expect(await userCanReadApplication(supabase, "app")).toBe(false);
  });
});
