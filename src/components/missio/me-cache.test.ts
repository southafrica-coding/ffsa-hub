import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMissioMeCache, loadMissioMe, subscribeMissioSignOut } from "./me-cache";
import type { MissioMe } from "./types-shim";

const me = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["pastor"] },
  currentOrg: "missio",
} as MissioMe;

describe("Missio /me cache", () => {
  afterEach(() => {
    clearMissioMeCache();
  });

  it("reuses one read until the signed-in session is cleared", async () => {
    const getMe = vi.fn(async () => me);
    await expect(loadMissioMe(getMe)).resolves.toBe(me);
    await expect(loadMissioMe(getMe)).resolves.toBe(me);
    expect(getMe).toHaveBeenCalledTimes(1);

    clearMissioMeCache();
    const next = { ...me, currentOrg: null } as MissioMe;
    const getNext = vi.fn(async () => next);
    await expect(loadMissioMe(getNext)).resolves.toBe(next);
    expect(getNext).toHaveBeenCalledTimes(1);
  });

  it("clears the cache when Supabase reports sign-out", async () => {
    const getMe = vi.fn(async () => me);
    await loadMissioMe(getMe);
    const listeners: Array<(event: string) => void> = [];
    const unsubscribe = vi.fn();
    const stop = subscribeMissioSignOut(
      {
        onAuthStateChange(callback: (event: string) => void) {
          listeners.push(callback);
          return { data: { subscription: { unsubscribe } } };
        },
      },
      clearMissioMeCache,
    );
    listeners[0]?.("TOKEN_REFRESHED");
    await loadMissioMe(getMe);
    expect(getMe).toHaveBeenCalledTimes(1);
    listeners[0]?.("SIGNED_OUT");
    const again = vi.fn(async () => me);
    await loadMissioMe(again);
    expect(again).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the client has no auth listener", () => {
    const onSignedOut = vi.fn();
    const stop = subscribeMissioSignOut({}, onSignedOut);
    stop();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
