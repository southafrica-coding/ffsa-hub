import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_ERROR,
  TIMEOUT_ERROR,
  completeOnboardingRequest,
  recordAgreements,
  withTimeout,
} from "./save-agreements";

// The NDA / policy save handlers behind onboarding's consent step and the
// gate's agreements panel. The bug they fix: a save that never resolved left
// the person on "Saving…" forever. Every path here must RESOLVE — ok, or a
// human error the screen can show next to "Try again".

const NDA = { kind: "nda", version: "nda-v1.0-2026-08", title: "Non-Disclosure Agreement" };
const PRIVACY = { kind: "privacy", version: "v1.0-2026-05-17", title: "Privacy Agreement" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("recordAgreements", () => {
  it("posts each agreement to /api/consent and resolves ok", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true }));
    const outcome = await recordAgreements([PRIVACY, NDA], { fetchImpl });

    expect(outcome).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/consent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "nda",
      agreement_version: "nda-v1.0-2026-08",
      source: "onboarding",
    });
  });

  it("treats an already-signed agreement (idempotent server reply) as success", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { success: true, alreadyAccepted: true })
    );
    expect(await recordAgreements([NDA], { fetchImpl })).toEqual({ ok: true });
  });

  it("resolves ok with nothing to sign", async () => {
    const fetchImpl = vi.fn();
    expect(await recordAgreements([], { fetchImpl })).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces the server's error and stops at the first failure", async () => {
    const fetchImpl = vi.fn(async () =>
      json(400, { error: "Agreement version mismatch. Please reload the page." })
    );
    const outcome = await recordAgreements([NDA, PRIVACY], { fetchImpl });

    expect(outcome).toEqual({
      ok: false,
      error: "Agreement version mismatch. Please reload the page.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("names the policy when the server gives no message (e.g. a gateway error page)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })
    );
    const outcome = await recordAgreements([NDA], { fetchImpl });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/Non-Disclosure Agreement/);
  });

  it("asks them to sign in again on 401", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "Not authenticated" }));
    const outcome = await recordAgreements([NDA], { fetchImpl });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/sign in again/);
  });

  it("turns a network failure into a plain message instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await recordAgreements([NDA], { fetchImpl })).toEqual({
      ok: false,
      error: NETWORK_ERROR,
    });
  });

  it("gives up on a request that never answers, so Saving… always ends", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          // Behave like fetch: reject only when aborted.
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const pending = recordAgreements([NDA], { fetchImpl, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await pending).toEqual({ ok: false, error: TIMEOUT_ERROR });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  });

  it("gives up when the response body stalls too", async () => {
    vi.useFakeTimers();
    const stalled = {
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => stalled);
    const pending = recordAgreements([NDA], { fetchImpl, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ ok: false, error: TIMEOUT_ERROR });
  });
});

describe("completeOnboardingRequest", () => {
  it("resolves ok when the account is marked set up", async () => {
    const fetchImpl = vi.fn(async (_url: string) => json(200, { success: true }));
    expect(await completeOnboardingRequest({ fetchImpl })).toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/onboarding/complete");
  });

  it("shows the server's error on failure", async () => {
    const fetchImpl = vi.fn(async () => json(500, { error: "permission denied" }));
    expect(await completeOnboardingRequest({ fetchImpl })).toEqual({
      ok: false,
      error: "permission denied",
    });
  });

  it("falls back to a readable message when there is none", async () => {
    const fetchImpl = vi.fn(async () => json(500, {}));
    const outcome = await completeOnboardingRequest({ fetchImpl });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/couldn't finish setting up/);
  });

  it("does not throw on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await completeOnboardingRequest({ fetchImpl })).toEqual({
      ok: false,
      error: NETWORK_ERROR,
    });
  });
});

describe("withTimeout", () => {
  it("passes a resolved value through", async () => {
    expect(await withTimeout(Promise.resolve({ error: null }))).toEqual({
      ok: true,
      value: { error: null },
    });
  });

  it("times out a promise that never settles", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 200);
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toEqual({ ok: false, error: TIMEOUT_ERROR });
  });

  it("turns a rejection into the network message", async () => {
    expect(await withTimeout(Promise.reject(new Error("boom")))).toEqual({
      ok: false,
      error: NETWORK_ERROR,
    });
  });
});
