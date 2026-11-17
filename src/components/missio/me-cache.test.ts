import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMissioMeCache, loadMissioMe } from "./me-cache";
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
});
