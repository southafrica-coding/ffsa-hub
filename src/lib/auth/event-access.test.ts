import { beforeEach, describe, expect, it } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";
import {
  ATTENDANCE_GATE,
  EVENT_CREATE_GATE,
  ORDERS_GATE,
  SCAN_LINK_GATE,
  allowsEventGate,
  canInsertEvent,
  canManageEvent,
  hasEventPermission,
  resetEventPermissionRpcCache,
  type EventAccessSnapshot,
  type EventGrant,
} from "./event-access";

const EVENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function grant(key: string, scopeType: string | null, scopeId: string | null = null): EventGrant {
  return { key, scopeType, scopeId, via: "direct" };
}

function snap(partial: Partial<EventAccessSnapshot> & { grants?: EventGrant[] }): EventAccessSnapshot {
  return {
    active: true,
    roles: [],
    grants: [],
    ...partial,
  };
}

describe("hasEventPermission (mirror of 314 lines 54–103)", () => {
  it("an unscoped grant counts for every event and for a null event id", () => {
    const access = snap({ grants: [grant("events.create", null)] });
    expect(hasEventPermission(access, "events.create", EVENT_A)).toBe(true);
    expect(hasEventPermission(access, "events.create", null)).toBe(true);
  });

  it("a scoped grant counts only for that event", () => {
    const access = snap({ grants: [grant("events.manage_registrations", "event", EVENT_A)] });
    expect(hasEventPermission(access, "events.manage_registrations", EVENT_A)).toBe(true);
    expect(hasEventPermission(access, "events.manage_registrations", EVENT_B)).toBe(false);
  });

  it("no grant is false", () => {
    expect(hasEventPermission(snap({}), "events.view", EVENT_A)).toBe(false);
  });

  it("a null event id ignores scoped grants and the creator arm", () => {
    const access = snap({ grants: [grant("events.create", "event", EVENT_A)] });
    expect(hasEventPermission(access, "events.create", null, { createdByCaller: true })).toBe(false);
  });

  it("the creator arm: created this event and holds the key scoped to any event", () => {
    const access = snap({ grants: [grant("events.create", "event", EVENT_A)] });
    expect(hasEventPermission(access, "events.create", EVENT_B, { createdByCaller: true })).toBe(true);
    expect(hasEventPermission(access, "events.create", EVENT_B, { createdByCaller: false })).toBe(false);
  });

  it("an inactive account gets nothing from a grant", () => {
    const access = snap({
      active: false,
      grants: [grant("events.create", null), grant("events.view", "event", EVENT_A)],
    });
    expect(hasEventPermission(access, "events.create", EVENT_A)).toBe(false);
    expect(hasEventPermission(access, "events.view", EVENT_A, { createdByCaller: true })).toBe(false);
  });

  it("program scope and other scope types never count", () => {
    const access = snap({
      grants: [
        grant("events.create", "program", EVENT_A),
        grant("events.view", "school", EVENT_A),
      ],
    });
    expect(hasEventPermission(access, "events.create", EVENT_A)).toBe(false);
    expect(hasEventPermission(access, "events.view", EVENT_A)).toBe(false);
    expect(hasEventPermission(access, "events.create", null)).toBe(false);
  });

  it("the key must match exactly: create does not imply view", () => {
    const access = snap({ grants: [grant("events.create", null)] });
    expect(hasEventPermission(access, "events.view", EVENT_A)).toBe(false);
    expect(hasEventPermission(access, "events.*", EVENT_A)).toBe(false);
  });

  it("a role-bundle grant uses the user_roles scope, not a global one", () => {
    const access = snap({
      grants: [{ key: "events.manage_attendance", scopeType: "event", scopeId: EVENT_A, via: "role" }],
    });
    expect(hasEventPermission(access, "events.manage_attendance", EVENT_A)).toBe(true);
    expect(hasEventPermission(access, "events.manage_attendance", EVENT_B)).toBe(false);
  });
});

describe("role bypasses sit outside the helper", () => {
  const admin = snap({ roles: [{ roleId: "r", name: "admin", scopeType: null, scopeId: null }] });
  const scopedAdmin = snap({
    roles: [{ roleId: "r", name: "admin", scopeType: "event", scopeId: EVENT_A }],
  });
  const finance = snap({
    roles: [{ roleId: "r", name: "finance_admin", scopeType: null, scopeId: null }],
  });
  const scopedFinance = snap({
    roles: [{ roleId: "r", name: "finance_admin", scopeType: "event", scopeId: EVENT_A }],
  });
  const eventsAdmin = snap({
    roles: [{ roleId: "r", name: "events_admin", scopeType: null, scopeId: null }],
  });

  it("unscoped admin passes every gate; a scoped admin does not", () => {
    expect(allowsEventGate(admin, ORDERS_GATE, EVENT_B)).toBe(true);
    expect(allowsEventGate(scopedAdmin, ORDERS_GATE, EVENT_A)).toBe(false);
  });

  it("finance_admin may refund and may not edit ticket types", () => {
    expect(allowsEventGate(finance, ORDERS_GATE, EVENT_B)).toBe(true);
    expect(allowsEventGate(finance, EVENT_CREATE_GATE, EVENT_B)).toBe(false);
    expect(allowsEventGate(scopedFinance, ORDERS_GATE, EVENT_A)).toBe(false);
  });

  it("events_admin is not a scan-link bypass", () => {
    expect(allowsEventGate(eventsAdmin, SCAN_LINK_GATE, EVENT_A)).toBe(false);
    expect(allowsEventGate(eventsAdmin, ATTENDANCE_GATE, EVENT_A)).toBe(true);
  });

  it("an inactive admin still matches is_admin(), which does not read is_active", () => {
    const inactive = snap({
      active: false,
      roles: [{ roleId: "r", name: "super_admin", scopeType: null, scopeId: null }],
    });
    expect(allowsEventGate(inactive, EVENT_CREATE_GATE, EVENT_A)).toBe(true);
  });
});

describe("canInsertEvent", () => {
  it("allows unscoped create, and any-scope create only as self", () => {
    const unscoped = snap({ grants: [grant("events.create", null)] });
    const scoped = snap({ grants: [grant("events.create", "event", EVENT_A)] });
    expect(canInsertEvent(unscoped, false)).toBe(true);
    expect(canInsertEvent(scoped, true)).toBe(true);
    expect(canInsertEvent(scoped, false)).toBe(false);
  });
});

describe("canManageEvent loads grants and falls back when the RPC is missing", () => {
  beforeEach(() => resetEventPermissionRpcCache());

  function client(world: PermissionWorld, extra?: (q: FakeQuery) => { data?: unknown; error?: unknown } | null) {
    return createFakeSupabase({
      user: { id: "u1" },
      resolve: (q) => extra?.(q) ?? permissionWorldResolver(world)(q) ?? { data: [] },
    }).client;
  }

  const scoped: PermissionWorld = {
    roles: [],
    direct: [{ module: "events", key: "events.manage_registrations", scopeType: "event", scopeId: EVENT_A }],
  };

  it("a scoped grant allows that event and refuses another", async () => {
    const db = client(scoped, (q) =>
      q.table === "events" ? { data: { created_by: "someone-else" } } : q.rpc ? { error: { code: "PGRST202", message: "Could not find the function public.has_event_permission in the schema cache" } } : null
    );
    expect(await canManageEvent(db, "u1", "events.manage_registrations", EVENT_A, ORDERS_GATE)).toBe(true);
    expect(await canManageEvent(db, "u1", "events.manage_registrations", EVENT_B, ORDERS_GATE)).toBe(false);
  });

  it("trusts a boolean from has_event_permission and does not widen it", async () => {
    const db = client(
      { roles: [], direct: [{ module: "events", key: "events.create" }] },
      (q) => (q.rpc?.name === "has_event_permission" ? { data: false } : null)
    );
    expect(await canManageEvent(db, "u1", "events.create", EVENT_A, EVENT_CREATE_GATE)).toBe(false);
  });

  it("a role bundle scoped to the event counts", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "door", name: "door", scopeType: "event", scopeId: EVENT_A }],
      direct: [],
      bundles: { door: [{ module: "events", key: "events.manage_attendance" }] },
    };
    const db = client(world, (q) =>
      q.table === "events"
        ? { data: { created_by: "nope" } }
        : q.rpc
          ? { error: { code: "PGRST202", message: "Could not find the function public.has_event_permission in the schema cache" } }
          : null
    );
    expect(await canManageEvent(db, "u1", ATTENDANCE_GATE.keys, EVENT_A, ATTENDANCE_GATE)).toBe(true);
    expect(await canManageEvent(db, "u1", ATTENDANCE_GATE.keys, EVENT_B, ATTENDANCE_GATE)).toBe(false);
  });
});
