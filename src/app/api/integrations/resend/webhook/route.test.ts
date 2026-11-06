import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  admin: 0,
  apply: 0,
  inbound: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    calls.admin += 1;
    const result = { data: null, error: null, count: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: () => b,
      upsert: () => b,
      update: () => b,
      insert: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return { from: () => b };
  },
}));
vi.mock("@/lib/email/ledger", () => ({
  applyProviderEvent: async () => {
    calls.apply += 1;
    return true;
  },
}));
vi.mock("@/lib/email/inbound", () => ({
  handleInboundEmail: async () => {
    calls.inbound += 1;
    return { ok: true };
  },
}));
vi.mock("@/lib/consent/record", () => ({
  recordConsentEvent: async () => ({ error: null }),
}));

import { POST } from "./route";

const SECRET_BYTES = Buffer.from("resend-webhook-test-secret");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function signature(
  body: string,
  secret = SECRET,
  id = "evt_1",
  timestamp = String(Math.floor(Date.now() / 1000))
) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { id, timestamp, header: `v1,${mac}` };
}

function signedAt(body: string, timestamp: string) {
  const sig = signature(body, SECRET, "evt_1", timestamp);
  return post(body, {
    "svix-id": sig.id,
    "svix-timestamp": sig.timestamp,
    "svix-signature": sig.header,
  });
}

function post(
  body: string,
  headers: Record<string, string> | null
) {
  return POST(
    new Request("http://x/api/integrations/resend/webhook", {
      method: "POST",
      body,
      headers: headers ?? {},
    })
  );
}

function signed(body: string, secret = SECRET) {
  const sig = signature(body, secret);
  return post(body, {
    "svix-id": sig.id,
    "svix-timestamp": sig.timestamp,
    "svix-signature": sig.header,
  });
}

const delivered = JSON.stringify({
  type: "email.delivered",
  data: { email_id: "msg_1", to: ["a@example.com"] },
});

describe("POST /api/integrations/resend/webhook", () => {
  beforeEach(() => {
    calls.admin = 0;
    calls.apply = 0;
    calls.inbound = 0;
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });

  it("refuses the event when the secret is missing or blank", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const missing = await signed(delivered);
    expect(missing.status).toBe(503);
    expect(await missing.text()).toBe("webhook secret not configured");

    process.env.RESEND_WEBHOOK_SECRET = "   ";
    expect((await signed(delivered)).status).toBe(503);
    expect(calls.admin).toBe(0);
    expect(calls.apply).toBe(0);
    expect(calls.inbound).toBe(0);
  });

  it("401 when the signature is missing or wrong", async () => {
    expect((await post(delivered, null)).status).toBe(401);
    expect((await post(delivered, { "svix-id": "evt_1" })).status).toBe(401);
    const wrong = await signed(delivered, `whsec_${Buffer.from("other-secret").toString("base64")}`);
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toBe("invalid signature");
    expect(calls.admin).toBe(0);
    expect(calls.apply).toBe(0);
  });

  it("processes a delivery only after the signature checks out", async () => {
    const res = await signed(delivered);
    expect(res.status).toBe(200);
    expect(calls.apply).toBe(1);
    expect(calls.admin).toBeGreaterThan(0);
  });

  it("rejects a valid signature whose timestamp is outside ±5 minutes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tooOld = await signedAt(delivered, String(now - 6 * 60));
    expect(tooOld.status).toBe(401);
    expect(await tooOld.text()).toBe("invalid signature");

    const tooFar = await signedAt(delivered, String(now + 6 * 60));
    expect(tooFar.status).toBe(401);

    // The timestamp the old tests signed with — years outside the window.
    expect((await signedAt(delivered, "1700000000")).status).toBe(401);
    expect(calls.apply).toBe(0);
    expect(calls.admin).toBe(0);

    expect((await signedAt(delivered, String(now - 4 * 60))).status).toBe(200);
    expect((await signedAt(delivered, String(now + 4 * 60))).status).toBe(200);
    expect(calls.apply).toBe(2);
  });

  it("processes an inbound reply only after the signature checks out", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "in_1" } });
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await signed(body)).status).toBe(503);
    expect(calls.inbound).toBe(0);

    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const res = await signed(body);
    expect(res.status).toBe(200);
    expect(calls.inbound).toBe(1);
  });
});
