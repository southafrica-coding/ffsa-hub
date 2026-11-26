import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { payfastProvider } from "@/lib/payments/payfast";
import { handleStoreItn, storePayfastAllowed, type ItnDeps } from "../payments";

// PHP urlencode, as PayFast signs.
const enc = (v: string) => encodeURIComponent(v.trim()).replace(/%20/g, "+").replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function signedItn(fields: Array<[string, string]>, passphrase: string) {
  const base = fields.map(([k, v]) => `${k}=${enc(v)}`).join("&");
  const sig = createHash("md5").update(passphrase ? `${base}&passphrase=${enc(passphrase)}` : base).digest("hex");
  return `${base}&signature=${sig}`;
}
const ORDER = "33333333-3333-4333-8333-333333333333";
const fields: Array<[string, string]> = [
  ["m_payment_id", ORDER],
  ["pf_payment_id", "1234567"],
  ["payment_status", "COMPLETE"],
  ["item_name", "Fire & Fragrance Store ST-AAAAAA"],
  ["amount_gross", "150.00"],
  ["email_address", "buyer@example.org"],
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function sandbox() {
  vi.stubEnv("PAYFAST_MERCHANT_ID", "10000100");
  vi.stubEnv("PAYFAST_MERCHANT_KEY", "46f0cd694581a");
  vi.stubEnv("PAYFAST_PASSPHRASE", "test-pass-phrase");
  vi.stubEnv("PAYFAST_MODE", "sandbox");
}

describe("PayFast ITN signature (the shared adapter, reused)", () => {
  it("accepts a correctly signed ITN after a VALID postback to the SANDBOX validator", async () => {
    sandbox();
    const fetchMock = vi.fn(async () => new Response("VALID"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await payfastProvider.verifyWebhook({ rawBody: signedItn(fields, "test-pass-phrase"), headers: new Headers(), sourceIp: null });
    expect(r).toEqual({ orderId: ORDER, status: "paid", providerPaymentId: "1234567", amountCents: 15000 });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("sandbox.payfast.co.za");
  });

  it("rejects a tampered amount or a wrong passphrase before any postback", async () => {
    sandbox();
    const fetchMock = vi.fn(async () => new Response("VALID"));
    vi.stubGlobal("fetch", fetchMock);
    const tampered = signedItn(fields, "test-pass-phrase").replace("amount_gross=150.00", "amount_gross=1.00");
    await expect(payfastProvider.verifyWebhook({ rawBody: tampered, headers: new Headers(), sourceIp: null })).rejects.toThrow(/signature mismatch/);
    await expect(payfastProvider.verifyWebhook({ rawBody: signedItn(fields, "wrong"), headers: new Headers(), sourceIp: null })).rejects.toThrow(/signature mismatch/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when PayFast's postback says INVALID", async () => {
    sandbox();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("INVALID")));
    await expect(payfastProvider.verifyWebhook({ rawBody: signedItn(fields, "test-pass-phrase"), headers: new Headers(), sourceIp: null })).rejects.toThrow(/postback/);
  });
});

describe("Store ITN handling", () => {
  function deps(over: Partial<ItnDeps> = {}) {
    const settle = vi.fn(async () => "settled" as const);
    const cancel = vi.fn(async () => {});
    const d: ItnDeps = {
      paymentsEnabled: () => true,
      verify: async () => ({ orderId: ORDER, status: "paid", providerPaymentId: "1234567", amountCents: 15000 }),
      loadOrder: async () => ({ id: ORDER, status: "pending", total_cents: 15000, payment_method: "payfast" }),
      settle,
      cancel,
      log: () => {},
      ...over,
    };
    return { d, settle, cancel };
  }

  it("settles a verified, matching payment", async () => {
    const { d, settle } = deps();
    expect(await handleStoreItn(d, "body")).toBe("settled");
    expect(settle).toHaveBeenCalledWith(ORDER, "1234567");
  });

  it("does nothing at all while STORE_PAYMENTS_ENABLED is off", async () => {
    const verify = vi.fn();
    const { d, settle } = deps({ paymentsEnabled: () => false, verify });
    expect(await handleStoreItn(d, "body")).toBe("ignored-disabled");
    expect(verify).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("never trusts a failed verification, an amount mismatch, or an EFT order", async () => {
    const bad = deps({ verify: async () => { throw new Error("signature mismatch"); } });
    expect(await handleStoreItn(bad.d, "x")).toBe("rejected");
    const short = deps({ verify: async () => ({ orderId: ORDER, status: "paid", providerPaymentId: "1", amountCents: 100 }) });
    expect(await handleStoreItn(short.d, "x")).toBe("amount-mismatch");
    const eft = deps({ loadOrder: async () => ({ id: ORDER, status: "pending", total_cents: 15000, payment_method: "eft" }) });
    expect(await handleStoreItn(eft.d, "x")).toBe("unknown-order");
    for (const x of [bad, short, eft]) expect(x.settle).not.toHaveBeenCalled();
  });

  it("cancels a pending order PayFast says was cancelled, but never a paid one", async () => {
    const c = deps({ verify: async () => ({ orderId: ORDER, status: "cancelled", providerPaymentId: null, amountCents: null }) });
    expect(await handleStoreItn(c.d, "x")).toBe("cancelled");
    expect(c.cancel).toHaveBeenCalledWith(ORDER);
    const late = deps({ verify: async () => ({ orderId: ORDER, status: "cancelled", providerPaymentId: null, amountCents: null }), loadOrder: async () => ({ id: ORDER, status: "paid", total_cents: 15000, payment_method: "payfast" }) });
    expect(await handleStoreItn(late.d, "x")).toBe("noop");
    expect(late.cancel).not.toHaveBeenCalled();
  });
});

describe("Store card payments are sandbox-only and off by default", () => {
  it("closed unless STORE_PAYMENTS_ENABLED=1", () => {
    sandbox();
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "");
    expect(storePayfastAllowed().ok).toBe(false);
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
    expect(storePayfastAllowed().ok).toBe(true);
  });

  it("refuses live PayFast unless a separate, deliberate switch is set", () => {
    sandbox();
    vi.stubEnv("STORE_PAYMENTS_ENABLED", "1");
    vi.stubEnv("PAYFAST_MODE", "live");
    expect(storePayfastAllowed()).toEqual({ ok: false, reason: "Card payments for the Store are in test mode only." });
  });
});
