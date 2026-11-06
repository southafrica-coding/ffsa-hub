import { describe, expect, it } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type FakeQuery, type PermissionWorld } from "@/lib/testing/fake-supabase";
import { canReadFinanceXero, getEventFinanceOrgPicker } from "./orgs";

// The event form's "Finance organisation" select. finance_org_choices()
// (migration 291) is the database gate; the helper adds the same check the
// event PATCH route makes, so the select only appears for people who can
// save it. The finance read gate for the Xero lists is checked alongside.

const ORGS = [
  { id: "org-npc", key: "npc", name: "FFSA NPC", record_currency: "ZAR", is_active: true, projects_category_name: "Ministries" },
  { id: "org-usa", key: "usa", name: "FF USA Inc", record_currency: "USD", is_active: true, projects_category_name: "Ministries" },
];

function client(world: PermissionWorld, perms: string[] = []) {
  return createFakeSupabase({
    user: { id: "me" },
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "has_permission") {
        return { data: perms.includes((q.rpc.args as { required_permission: string }).required_permission) };
      }
      if (q.rpc?.name === "finance_org_choices") return { data: ORGS };
      return permissionWorldResolver(world)(q) ?? { data: [] };
    },
  });
}

const EVENTS_ADMIN: PermissionWorld = { roles: [{ id: "r", name: "events_admin" }], direct: [] };
const EVENTS_CREATE: PermissionWorld = { roles: [], direct: [{ module: "events", key: "events.create" }] };
const NOBODY: PermissionWorld = { roles: [{ id: "r", name: "staff" }], direct: [] };

describe("getEventFinanceOrgPicker", () => {
  it("an events admin gets the two org names, and nothing else, without finance.view", async () => {
    const fake = client(EVENTS_ADMIN);
    const picker = await getEventFinanceOrgPicker(fake.client, "me");
    expect(picker.canPick).toBe(true);
    expect(picker.orgs).toEqual([
      { id: "org-npc", key: "npc", name: "FFSA NPC", record_currency: "ZAR", is_active: true },
      { id: "org-usa", key: "usa", name: "FF USA Inc", record_currency: "USD", is_active: true },
    ]);
    expect(fake.queries.some((q) => /finance_projects|xero_/.test(q.table))).toBe(false);
  });

  it("someone with events.create can pick too", async () => {
    expect((await getEventFinanceOrgPicker(client(EVENTS_CREATE).client, "me")).canPick).toBe(true);
  });

  it("a signed-in user with no events and no finance access gets nothing, and the orgs aren't even asked for", async () => {
    const fake = client(NOBODY);
    expect(await getEventFinanceOrgPicker(fake.client, "me")).toEqual({ canPick: false, orgs: [] });
    expect(fake.queries.some((q) => q.rpc?.name === "finance_org_choices")).toBe(false);
  });

  it("signed out gets nothing", async () => {
    expect(await getEventFinanceOrgPicker(client(EVENTS_ADMIN).client, null)).toEqual({ canPick: false, orgs: [] });
  });

  it("before migration 291 (no function) there is simply no select", async () => {
    const fake = createFakeSupabase({
      user: { id: "me" },
      resolve: (q) =>
        q.rpc?.name === "finance_org_choices"
          ? { error: { message: "function public.finance_org_choices() does not exist" } }
          : permissionWorldResolver(EVENTS_ADMIN)(q) ?? { data: [] },
    });
    expect(await getEventFinanceOrgPicker(fake.client, "me")).toEqual({ canPick: false, orgs: [] });
  });
});

describe("canReadFinanceXero", () => {
  it.each([
    ["finance_admin role", { roles: [{ id: "r", name: "finance_admin" }], direct: [] }, []],
    ["admin role", { roles: [{ id: "r", name: "admin" }], direct: [] }, []],
    ["finance.view", NOBODY, ["finance.view"]],
    ["finance.edit", NOBODY, ["finance.edit"]],
    ["budget.view_all", NOBODY, ["budget.view_all"]],
  ] as const)("allows %s", async (_l, world, perms) => {
    expect(await canReadFinanceXero(client(world as PermissionWorld, [...perms]).client, "me")).toBe(true);
  });

  it.each([
    ["an events admin", EVENTS_ADMIN],
    ["plain staff", NOBODY],
  ] as const)("refuses %s", async (_l, world) => {
    expect(await canReadFinanceXero(client(world).client, "me")).toBe(false);
  });
});
