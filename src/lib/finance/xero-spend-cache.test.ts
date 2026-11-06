import { describe, expect, it } from "vitest";
import { cachedXeroRead, clearXeroReadCache } from "./xero-spend-cache";

describe("cachedXeroRead", () => {
  it("loads a successful read once and shares it", async () => {
    clearXeroReadCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { ok: true as const, n: calls };
    };
    const first = await cachedXeroRead("spend:za:2026", load);
    const second = await cachedXeroRead("spend:za:2026", load);
    expect(first).toEqual({ ok: true, n: 1 });
    expect(second).toEqual({ ok: true, n: 1 });
    expect(calls).toBe(1);
  });
});