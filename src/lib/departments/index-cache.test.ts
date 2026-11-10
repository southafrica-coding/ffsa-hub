import { beforeEach, describe, expect, it, vi } from "vitest";

const readIndex = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache<T extends (client: object) => unknown>(fn: T): T {
      const store = new WeakMap<object, ReturnType<T>>();
      return ((client: object) => {
        const cached = store.get(client);
        if (cached !== undefined) return cached;
        const value = fn(client);
        store.set(client, value as ReturnType<T>);
        return value;
      }) as T;
    },
  };
});

vi.mock("@/lib/departments", () => ({
  loadDepartmentsIndexForViewer: (client: unknown) => readIndex(client),
}));

import { loadCachedDepartmentsIndex } from "./load";

describe("cached department index", () => {
  beforeEach(() => {
    readIndex.mockReset();
    readIndex.mockResolvedValue({ kind: "ok", data: [] });
  });

  it("reads the index once for the same session client", async () => {
    const client = { kind: "session" };
    await loadCachedDepartmentsIndex(client);
    await loadCachedDepartmentsIndex(client);
    expect(readIndex).toHaveBeenCalledTimes(1);
    expect(readIndex).toHaveBeenCalledWith(client);
  });
});
