import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";
import { resetEventPermissionRpcCache } from "@/lib/auth/event-access";

// Out-of-scope refunds, refund-all, the cancellation notice and the
// order email resend must 403 before Stripe, PayFast or Resend run.
// A delete that changes 0 rows is 403, not a silent 200.

const stripeRefund = vi.hoisted(() => vi.fn());
const payfastRefund = vi.hoisted(() => vi.fn());
const sendViaResend = vi.hoisted(() => vi.fn());
const fulfillOrder = vi.hoisted(() => vi.fn());
const adminHits = vi.hoisted(() => ({ n: 0, voids: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/payments/stripe", () => ({
  stripeProvider: {
    name: "stripe",
    refundPayment: stripeRefund,
    createCheckout: vi.fn(),
    verifyWebhook: vi.fn(),
  },
  retrieveStripeCheckoutStatus: vi.fn(),
}));
vi.mock("@/lib/payments/payfast", () => ({
  payfastProvider: {
    name: "payfast",
    refundPayment: payfastRefund,
    createCheckout: vi.fn(),
    verifyWebhook: vi.fn(),
  },
}));
vi.mock("@/lib/email/resend", () => ({ getResend: () => null, isEmailConfigured: () => false }));
vi.mock("@/lib/email/resend-send", () => ({ sendViaResend, isEmailConfigured: () => false }));
vi.mock("@/lib/ticketing/fulfillment", () => ({ fulfillOrder }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminHits.n += 1;
    return {
      from(table: string) {
        const op: { action: string; payload: Record<string, unknown> | null } = {
          action: "select",
          payload: null,
        };
        const builder: Record<string, unknown> = {
          update(payload: Record<string, unknown>) {
            op.action = "update";
            op.payload = payload;
            return builder;
          },
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          insert() {
            op.action = "insert";
            return builder;
          },
          then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
            if (table === "tickets" && op.action === "update") adminHits.voids.push(op.payload ?? {});
            return Promise.resolve({ data: [{ id: "t1" }], error: null }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
    };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));

import { POST as refundPost } from "./[id]/orders/[orderId]/refund/route";
import { POST as refundAll } from "./[id]/orders/refund-all/route";
import { POST as cancelNotice } from "./[id]/send-cancellation-notice/route";
import { POST as resendEmail } from "./[id]/orders/[orderId]/resend-email/route";
import { DELETE as deletePromo } from "./[id]/promo-codes/[promoCodeId]/route";
import { DELETE as deleteTier } from "./[id]/ticket-types/[ticketTypeId]/route";
import { GET as scanLink } from "./[id]/scan-link/route";
import { PATCH as ticketingPatch } from "./[id]/ticketing/route";
import { POST as promoPost } from "./[id]/promo-codes/route";

const EVENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof createFakeSupabase>,
}));

const PAID = {
  id: "order-1",
  event_id: EVENT_B,
  status: "paid",
  total_cents: 5000,
  refund_cents: 0,
  currency: "ZAR",
  payment_provider: "stripe",
  provider_payment_id: "pi_test",
  lines: [],
  buyer_contact_id: null,
  buyer_first_name: "A",
  buyer_email: "a@example.com",
};

function worldOf(world: PermissionWorld) {
  state.fake = createFakeSupabase({
    user: { id: "u1" },
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "has_event_permission") {
        return {
          error: {
            code: "PGRST202",
            message: "Could not find the function public.has_event_permission in the schema cache",
          },
        };
      }
      if (q.table === "orders") return { data: PAID };
      if (q.table === "events") return { data: { id: EVENT_B, created_by: "other", title: "B", cancellation_message: null } };
      if (q.table === "promo_codes" && q.action === "delete") return { data: [] };
      if (q.table === "promo_codes") {
        return { data: { id: "promo-1", event_id: EVENT_B, redemption_count: 0 } };
      }
      if (q.table === "ticket_types") return { data: { id: "tier-1", event_id: EVENT_B } };
      return permissionWorldResolver(world)(q) ?? { data: [] };
    },
  });
}

const scopedRegs: PermissionWorld = {
  roles: [{ id: "r", name: "staff" }],
  direct: [{ module: "events", key: "events.manage_registrations", scopeType: "event", scopeId: EVENT_A }],
};
const finance: PermissionWorld = { roles: [{ id: "r", name: "finance_admin" }], direct: [] };
const eventsAdmin: PermissionWorld = { roles: [{ id: "r", name: "events_admin" }], direct: [] };

const json = (body: unknown) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  resetEventPermissionRpcCache();
  stripeRefund.mockReset();
  payfastRefund.mockReset();
  sendViaResend.mockReset();
  fulfillOrder.mockReset();
  adminHits.n = 0;
  adminHits.voids = [];
  stripeRefund.mockResolvedValue({ status: "succeeded", providerRefundId: "re", amountCents: 5000, error: null });
  payfastRefund.mockResolvedValue({ status: "succeeded", providerRefundId: "re", amountCents: 5000, error: null });
});

describe("refund and refund-all stay inside the order's event", () => {
  it("403 for a refund on an event outside the grant, and never calls a provider", async () => {
    worldOf(scopedRegs);
    const res = await refundPost(json({}), { params: Promise.resolve({ id: EVENT_B, orderId: "order-1" }) });
    expect(res.status).toBe(403);
    expect(stripeRefund).not.toHaveBeenCalled();
    expect(payfastRefund).not.toHaveBeenCalled();
    expect(adminHits.n).toBe(0);
  });

  it("403 for refund-all outside the grant, and never calls a provider", async () => {
    worldOf(scopedRegs);
    const res = await refundAll(json({}), { params: Promise.resolve({ id: EVENT_B }) });
    expect(res.status).toBe(403);
    expect(stripeRefund).not.toHaveBeenCalled();
    expect(payfastRefund).not.toHaveBeenCalled();
  });

  it("finance_admin may refund and may not delete a ticket type", async () => {
    worldOf(finance);
    const refund = await refundPost(json({ method: "manual" }), {
      params: Promise.resolve({ id: EVENT_B, orderId: "order-1" }),
    });
    expect(refund.status).not.toBe(403);

    worldOf(finance);
    const tier = await deleteTier(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: EVENT_B, ticketTypeId: "tier-1" }),
    });
    expect(tier.status).toBe(403);
    expect(state.fake.queries.some((q) => q.table === "ticket_types" && q.action === "delete")).toBe(false);
  });
});

describe("email side effects", () => {
  it("finance_admin alone cannot send the cancellation notice", async () => {
    worldOf(finance);
    const res = await cancelNotice(json({}), { params: Promise.resolve({ id: EVENT_B }) });
    expect(res.status).toBe(403);
    expect(sendViaResend).not.toHaveBeenCalled();
  });

  it("cancellation notice 403 does not send", async () => {
    worldOf(scopedRegs);
    const res = await cancelNotice(json({}), { params: Promise.resolve({ id: EVENT_B }) });
    expect(res.status).toBe(403);
    expect(sendViaResend).not.toHaveBeenCalled();
  });

  it("resend-email 403 does not fulfil or send", async () => {
    worldOf(scopedRegs);
    const res = await resendEmail(json({}), {
      params: Promise.resolve({ id: EVENT_B, orderId: "order-1" }),
    });
    expect(res.status).toBe(403);
    expect(fulfillOrder).not.toHaveBeenCalled();
    expect(sendViaResend).not.toHaveBeenCalled();
  });
});

describe("full refund voids tickets after the provider, without attendance rights", () => {
  it("voids through the service role when the refunder cannot manage attendance", async () => {
    worldOf({
      roles: [{ id: "r", name: "staff" }],
      direct: [{ module: "events", key: "events.manage_registrations", scopeType: "event", scopeId: EVENT_B }],
    });
    const steps: string[] = [];
    stripeRefund.mockImplementation(async () => {
      steps.push("provider");
      return { status: "succeeded", providerRefundId: "re", amountCents: 5000, error: null };
    });
    const res = await refundPost(json({}), { params: Promise.resolve({ id: EVENT_B, orderId: "order-1" }) });
    expect(res.status).not.toBe(403);
    expect(steps).toEqual(["provider"]);
    expect(adminHits.voids).toEqual([{ status: "void" }]);
    expect(stripeRefund).toHaveBeenCalledTimes(1);
  });

  it("does not void or call the provider when the order is outside scope", async () => {
    worldOf(scopedRegs);
    const res = await refundPost(json({}), { params: Promise.resolve({ id: EVENT_B, orderId: "order-1" }) });
    expect(res.status).toBe(403);
    expect(stripeRefund).not.toHaveBeenCalled();
    expect(payfastRefund).not.toHaveBeenCalled();
    expect(adminHits.voids).toEqual([]);
    expect(adminHits.n).toBe(0);
  });
});

describe("RLS denials are 403", () => {
  it("ticketing settings update maps 42501 to 403", async () => {
    state.fake = createFakeSupabase({
      user: { id: "u1" },
      resolve: (q: FakeQuery) => {
        if (q.rpc?.name === "has_event_permission") {
          return {
            error: {
              code: "PGRST202",
              message: "Could not find the function public.has_event_permission in the schema cache",
            },
          };
        }
        if (q.table === "events" && q.action === "update") {
          return { error: { code: "42501", message: "permission denied for table events" } };
        }
        if (q.table === "events") return { data: { id: EVENT_B, created_by: "other", public_slug: "send-night" } };
        return permissionWorldResolver(eventsAdmin)(q) ?? { data: [] };
      },
    });
    const res = await ticketingPatch(json({ ticketing_enabled: false }), {
      params: Promise.resolve({ id: EVENT_B }),
    });
    expect(res.status).toBe(403);
  });

  it("promo insert maps 42501 to 403", async () => {
    state.fake = createFakeSupabase({
      user: { id: "u1" },
      resolve: (q: FakeQuery) => {
        if (q.rpc?.name === "has_event_permission") {
          return {
            error: {
              code: "PGRST202",
              message: "Could not find the function public.has_event_permission in the schema cache",
            },
          };
        }
        if (q.table === "promo_codes" && q.action === "insert") {
          return { error: { code: "42501", message: "new row violates row-level security policy" } };
        }
        if (q.table === "ticket_types") return { data: [] };
        if (q.table === "events") return { data: { id: EVENT_B, created_by: "other" } };
        return permissionWorldResolver(eventsAdmin)(q) ?? { data: [] };
      },
    });
    const res = await promoPost(json({ code: "DOOR", kind: "comp" }), {
      params: Promise.resolve({ id: EVENT_B }),
    });
    expect(res.status).toBe(403);
  });
});

describe("scan links and empty deletes", () => {
  it("events_admin alone cannot mint a scan link", async () => {
    worldOf(eventsAdmin);
    const res = await scanLink(new Request("http://x"), { params: Promise.resolve({ id: EVENT_B }) });
    expect(res.status).toBe(403);
    expect(adminHits.n).toBe(0);
  });

  it("a 0-row promo delete is 403", async () => {
    worldOf(eventsAdmin);
    const res = await deletePromo(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: EVENT_B, promoCodeId: "promo-1" }),
    });
    expect(res.status).toBe(403);
  });
});
