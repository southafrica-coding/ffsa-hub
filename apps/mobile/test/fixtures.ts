// Shared test fixtures (not a test file). Placeholder data only.

import type { z } from "zod";

import { ApiError, meSchema, type Me } from "@/lib/api";

export function makeMe(overrides: Partial<z.input<typeof meSchema>> = {}): Me {
  return meSchema.parse({
    user: { id: "u1", email: "jo@example.org" },
    profile: { firstName: "Sample", lastName: "Person", preferredName: "Sample", avatarUrl: null, isActive: true },
    roles: [{ name: "staff", scopeType: null, scopeId: null }],
    permissions: [{ key: "events.view", scopeType: null, scopeId: null, source: "role" }],
    serverTime: "2026-11-03T08:00:00.000Z",
    ...overrides,
  });
}

type Route = unknown | ((init?: { method?: string; body?: unknown }) => unknown);

/**
 * An apiFetch stand-in that answers by path. A value is returned as-is
 * (parsed by the caller's schema if given), an Error is thrown, a function is
 * called with the request init.
 */
export function apiRoutes(routes: Record<string, Route>) {
  return async (path: string, init?: { method?: string; body?: unknown; schema?: { parse: (v: unknown) => unknown } }) => {
    if (!(path in routes)) throw new ApiError("http", `No mock for ${path}`, 404);
    const r = routes[path];
    const value = typeof r === "function" ? await (r as (i?: unknown) => unknown)(init) : r;
    if (value instanceof Error) throw value;
    return init?.schema ? init.schema.parse(value) : value;
  };
}
