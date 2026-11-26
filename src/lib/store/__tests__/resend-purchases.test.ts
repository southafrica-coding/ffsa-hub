import { describe, expect, it, vi } from "vitest";
import { InMemoryRateLimiter } from "@/lib/rate-limit";
import { NEUTRAL_RESEND_MESSAGE, NEUTRAL_SIGNIN_MESSAGE, resendPurchases, sendSignInLink, type ResendDeps } from "../resend-purchases";

const PAID = {
  "has@example.org": [
    { reference: "ST-AAAAAA", items: [{ title: "Example Review", variant_label: null, quantity: 1, purpose: "self" }] },
    { reference: "ST-BBBBBB", items: [{ title: "Example Tee", variant_label: "M", quantity: 2, purpose: "self" }, { title: "Example Review", variant_label: null, quantity: 1, purpose: "gift" }] },
  ],
} as Record<string, Array<{ reference: string; items: Array<{ title: string; variant_label: string | null; quantity: number; purpose: string }> }>>;

function deps(over: Partial<ResendDeps> = {}) {
  const send = vi.fn(async () => ({ ok: true }));
  const findPaidOrders = vi.fn(async (email: string) => PAID[email] ?? []);
  const makeSignInLink = vi.fn(async () => "https://hub.test/store/auth/confirm?token_hash=t");
  const d: ResendDeps = { limiter: new InMemoryRateLimiter(() => Date.UTC(2026, 10, 26)), findPaidOrders, makeSignInLink, send, ...over };
  return { d, send, findPaidOrders, makeSignInLink };
}

describe("Resend my purchases", () => {
  it("sends ONE email listing every paid purchase, with a sign-in link", async () => {
    const { d, send } = deps();
    const r = await resendPurchases(d, { email: " Has@Example.org ", ip: "1.1.1.1" });
    expect(r).toEqual({ message: NEUTRAL_RESEND_MESSAGE, sent: true, reason: undefined });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = (send.mock.calls[0] as unknown as [{ to: string; html: string }])[0];
    expect(mail.to).toBe("has@example.org");
    for (const s of ["ST-AAAAAA", "ST-BBBBBB", "Example Tee (M) × 2", "sent as a gift", "token_hash=t"]) expect(mail.html).toContain(s);
  });

  it("only paid orders count: an email with none gets nothing, and the same answer", async () => {
    const { d, send, makeSignInLink } = deps();
    const r = await resendPurchases(d, { email: "none@example.org", ip: "1.1.1.1" });
    expect(r.message).toBe(NEUTRAL_RESEND_MESSAGE);
    expect(r.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(makeSignInLink).not.toHaveBeenCalled(); // no account minted either
  });

  it("answers the same for junk input", async () => {
    const { d, send } = deps();
    for (const email of [undefined, "", "not-an-email", 42, "x".repeat(300) + "@example.org"]) {
      expect((await resendPurchases(d, { email, ip: "1.1.1.1" })).message).toBe(NEUTRAL_RESEND_MESSAGE);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("limits each email to 3 an hour, still neutral", async () => {
    const { d, send } = deps();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await resendPurchases(d, { email: "has@example.org", ip: `10.0.0.${i}` }));
    expect(send).toHaveBeenCalledTimes(3);
    expect(results.map((r) => r.message)).toEqual(Array(5).fill(NEUTRAL_RESEND_MESSAGE));
    expect(results[4].reason).toBe("limited");
  });

  it("limits each IP to 10 an hour across emails", async () => {
    const { d, findPaidOrders } = deps();
    for (let i = 0; i < 12; i++) await resendPurchases(d, { email: `n${i}@example.org`, ip: "9.9.9.9" });
    expect(findPaidOrders).toHaveBeenCalledTimes(10);
  });

  it("the sign-in link form follows the same rules", async () => {
    const { d, send } = deps({ hasAnyPurchase: async (e) => e === "has@example.org" });
    expect(await sendSignInLink(d, { email: "has@example.org", ip: "1.1.1.1" })).toMatchObject({ message: NEUTRAL_SIGNIN_MESSAGE, sent: true });
    expect(await sendSignInLink(d, { email: "none@example.org", ip: "1.1.1.1" })).toMatchObject({ message: NEUTRAL_SIGNIN_MESSAGE, sent: false });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
