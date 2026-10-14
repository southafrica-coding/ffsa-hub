import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sync = vi.fn();
const afterCallbacks: Array<() => Promise<void>> = [];

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<void>) => afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/services/billing-payments", () => ({ syncInvoicePayments: (...a: unknown[]) => sync(...a) }));

const { POST } = await import("./route");

const KEY = "test-webhook-key";
const sign = (body: string, key = KEY) => createHmac("sha256", key).update(body).digest("base64");
const req = (body: string, sig: string | null) =>
  new Request("http://localhost/api/integrations/xero/webhook", {
    method: "POST",
    body,
    headers: sig ? { "x-xero-signature": sig } : {},
  });

describe("Xero webhook", () => {
  beforeEach(() => {
    process.env.XERO_WEBHOOK_KEY = KEY;
    sync.mockReset();
    sync.mockResolvedValue({ chargesUpdated: 0, errors: [], voided: [] });
    afterCallbacks.length = 0;
  });

  it("passes Xero's intent-to-receive check: 200 when signed, 401 with an empty body when not", async () => {
    const body = JSON.stringify({ events: [], firstEventSequence: 0, lastEventSequence: 0, entropy: "X" });
    const good = await POST(req(body, sign(body)));
    expect(good.status).toBe(200);

    const bad = await POST(req(body, sign(body, "wrong-key")));
    expect(bad.status).toBe(401);
    expect(await bad.text()).toBe("");

    expect((await POST(req(body, null))).status).toBe(401);
  });

  it("refuses everything when no key is configured", async () => {
    delete process.env.XERO_WEBHOOK_KEY;
    const body = JSON.stringify({ events: [] });
    expect((await POST(req(body, sign(body)))).status).toBe(401);
  });

  it("syncs only the invoice events, after responding", async () => {
    const body = JSON.stringify({
      events: [
        { resourceId: "inv-1", eventCategory: "INVOICE", eventType: "UPDATE", tenantId: "t" },
        { resourceId: "con-1", eventCategory: "CONTACT", eventType: "UPDATE", tenantId: "t" },
        { resourceId: "inv-2", eventCategory: "INVOICE", eventType: "CREATE", tenantId: "t" },
      ],
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect(sync).not.toHaveBeenCalled(); // not before the response

    await afterCallbacks[0]();
    expect(sync).toHaveBeenCalledWith({}, { invoiceIds: ["inv-1", "inv-2"] });
  });
});
