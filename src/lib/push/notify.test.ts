import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type FakeQuery } from "@/lib/testing/fake-supabase";

// The write-point helpers: right recipients, the feed's own keys, and no
// throw whatever goes wrong underneath.

const h = vi.hoisted(() => ({
  sent: [] as { userIds: string[]; input: { kind: string; key: string; href: string } }[],
  sendThrows: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: null as any,
  adminThrows: false,
}));

vi.mock("./send", () => ({
  sendPush: async (userIds: string[], input: { kind: string; key: string; href: string }) => {
    if (h.sendThrows) throw new Error("push exploded");
    h.sent.push({ userIds, input });
    return { sent: userIds.length, failed: 0, revoked: 0 };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.adminThrows) throw new Error("no env");
    return h.admin;
  },
}));

const { bookingDecisionKey, notifyBookingDecision, notifyNewBookingRequest } = await import("./notify");
const { bookingApproverIds } = await import("./recipients");

// Approvers: "adm" (admin role), "direct" (bookings.approve granted), "bundled"
// (holds role r-approver whose bundle includes bookings.approve), "req" (the
// requester, also an approver), and "viewer" (bookings.view only).
function approverWorld() {
  return createFakeSupabase({
    resolve(q: FakeQuery) {
      if (q.table === "user_roles" && q.columns?.includes("roles!inner")) {
        return { data: [{ user_id: "adm", roles: { name: "admin" } }] };
      }
      if (q.table === "user_permissions") {
        return { data: [{ user_id: "direct" }, { user_id: "req" }] };
      }
      if (q.table === "role_permissions") return { data: [{ role_id: "r-approver" }] };
      if (q.table === "user_roles") return { data: [{ user_id: "bundled" }, { user_id: "adm" }] };
      return { data: [] };
    },
  });
}

beforeEach(() => {
  h.sent = [];
  h.sendThrows = false;
  h.adminThrows = false;
  h.admin = approverWorld().client;
});

describe("bookingApproverIds", () => {
  it("admins + direct grants + role bundles, deduplicated", async () => {
    const ids = await bookingApproverIds(h.admin);
    expect(ids.sort()).toEqual(["adm", "bundled", "direct", "req"]);
  });

  it("asks for exactly bookings.approve and the admin roles", async () => {
    const world = permissionWorldResolver({ roles: [], direct: [] });
    const fake = createFakeSupabase({ resolve: (q) => world(q) ?? {} });
    await bookingApproverIds(fake.client);
    const perms = fake.queries.filter((q) => q.table === "user_permissions" || q.table === "role_permissions");
    for (const q of perms) {
      expect(q.filters).toContainEqual({ op: "eq", args: ["permissions.key", "bookings.approve"] });
    }
    const roles = fake.queries.find((q) => q.table === "user_roles")!;
    expect(roles.filters).toContainEqual({ op: "in", args: ["roles.name", ["super_admin", "admin"]] });
  });
});

describe("notifyNewBookingRequest", () => {
  it("pushes the approvers except the requester, with the feed's key", async () => {
    await notifyNewBookingRequest({ requesterId: "req", bookingId: "b1" });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].userIds.sort()).toEqual(["adm", "bundled", "direct"]);
    expect(h.sent[0].input).toEqual({ kind: "booking_request", key: "booking:b1", href: "/bookings/requests" });
  });

  it("a weekly series carries the series key", async () => {
    await notifyNewBookingRequest({ requesterId: "req", seriesId: "s1" });
    expect(h.sent[0].input.key).toBe("booking-series:s1");
  });

  it("never throws (sender or admin client failing)", async () => {
    h.sendThrows = true;
    await expect(notifyNewBookingRequest({ requesterId: "req", bookingId: "b1" })).resolves.toBeUndefined();
    h.adminThrows = true;
    await expect(notifyNewBookingRequest({ requesterId: "req", bookingId: "b1" })).resolves.toBeUndefined();
  });
});

describe("notifyBookingDecision", () => {
  const booking = { requested_by: "req", series_id: null, title: "Staff lunch", venue_id: "v1", start_time: "12:00", end_time: "13:00" };

  it("pushes the requester with the same key bookingDecisionNotifs uses", async () => {
    await notifyBookingDecision({ booking, status: "approved", deciderId: "adm" });
    expect(h.sent).toEqual([
      {
        userIds: ["req"],
        input: {
          kind: "booking_decision",
          key: "booking-decision:sig:Staff lunch|v1|12:00|13:00:approved",
          href: "/bookings",
        },
      },
    ]);
  });

  it("series key groups by series", () => {
    expect(bookingDecisionKey({ series_id: "s9" }, "denied")).toBe("booking-decision:s:s9:denied");
  });

  it("no push when someone decides their own request, or nobody asked", async () => {
    await notifyBookingDecision({ booking, status: "approved", deciderId: "req" });
    await notifyBookingDecision({ booking: { ...booking, requested_by: null }, status: "denied", deciderId: "adm" });
    expect(h.sent).toEqual([]);
  });

  it("never throws", async () => {
    h.sendThrows = true;
    await expect(notifyBookingDecision({ booking, status: "denied", deciderId: "adm" })).resolves.toBeUndefined();
  });
});
