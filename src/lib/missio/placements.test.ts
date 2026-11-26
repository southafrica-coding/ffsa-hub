import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  let limitN = Infinity;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (action === "insert") {
      const row = { id: `id-${rows().length + 1}`, ...payload };
      rows().push(row);
      return [row];
    }
    const hit = rows().filter((row) => filters.every((f) => f(row)));
    if (action === "update") for (const row of hit) Object.assign(row, payload);
    return hit.slice(0, limitN);
  };
  const b = {
    select: () => b,
    insert: (value: Row) => ((action = "insert"), (payload = value), b),
    update: (value: Row) => ((action = "update"), (payload = value), b),
    eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), b),
    is: (col: string, val: unknown) => (filters.push((row) => (row[col] ?? null) === val), b),
    in: (col: string, vals: unknown[]) => (filters.push((row) => vals.includes(row[col])), b),
    gte: (col: string, val: string) => (filters.push((row) => String(row[col]) >= val), b),
    order: () => b,
    limit: (n: number) => ((limitN = n), b),
    maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
  };
  return b;
}
const db = { from };

const { createPlacement, leaderPage, leaderStep, personCantMakeIt, personPage, stepPlacement } = await import("./placements");

const HOUSE = "11111111-1111-4111-8111-111111111111";
const SIPHO = "22222222-2222-4222-8222-222222222222";
const auth = { supabase: db, orgId: "org-missio", user: { id: "pastor-1" } } as never;
const now = new Date("2026-11-19T08:00:00Z");
const raw = (path: string) => path.split("/").pop() as string;

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = "a-test-secret-that-is-long-enough-for-hmac";
  tables.house_churches = [{ id: HOUSE, org_id: "org-missio", campus: "potch", number: 5, name: null, meeting_day: "wednesday", location: "12 Oak St" }];
  tables.contacts = [
    { id: SIPHO, first_name: "Sipho", last_name: "Dlamini", preferred_name: null, phone: "082 555 0101" },
    { id: "c-chris", first_name: "Chris", last_name: "Naidoo", preferred_name: null, phone: "083 555 0202" },
  ];
  tables.house_church_members = [{ id: "m1", house_church_id: HOUSE, contact_id: "c-chris", role: "leader", ended_at: null }];
});

describe("placements", () => {
  it("places someone, with links and a leader deadline three days out", async () => {
    const result = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    if (!result.ok) throw new Error(result.code);
    expect(result.placement.leaderDeadline).toBe("2026-11-22");
    expect(result.placement.leaders).toEqual([{ name: "Chris Naidoo", phone: "083 555 0202" }]);
    expect(result.placement.next).toBe("said_hi");
    expect(result.placement.links?.person).toMatch(/^\/serve\/missio\/w\/[A-Za-z0-9_-]{43}$/);
    expect(tables.org_people).toHaveLength(1);
    const stored = tables.missio_placements![0]!;
    expect(JSON.stringify(stored)).not.toContain(raw(result.placement.links!.person));
  });

  it("refuses someone already in the house", async () => {
    tables.house_church_members!.push({ id: "m2", house_church_id: HOUSE, contact_id: SIPHO, role: "member", ended_at: null });
    const result = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    expect(result.ok ? null : result.code).toBe("already_member");
  });

  it("hides the address from the person until the leader says hi", async () => {
    const placed = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    if (!placed.ok) throw new Error(placed.code);
    const person = raw(placed.placement.links!.person);
    const leader = raw(placed.placement.links!.leader);
    const before = await personPage(db as never, person, now);
    expect(before.ok && before.view.house.location).toBe(null);
    expect(before.ok && before.view.person.phone).toBe(null);

    const hi = await leaderStep(db as never, leader, { step: "said_hi" }, now);
    expect(hi.ok && hi.view.next).toBe("first_visit");
    const after = await personPage(db as never, person, now);
    expect(after.ok && after.view.house.location).toBe("12 Oak St");
  });

  it("lets the leader see the person's phone, and the person say they can't make it", async () => {
    const placed = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    if (!placed.ok) throw new Error(placed.code);
    const page = await leaderPage(db as never, raw(placed.placement.links!.leader), now);
    expect(page.ok && page.view.person.phone).toBe("082 555 0101");
    await personCantMakeIt(db as never, raw(placed.placement.links!.person), now);
    expect(tables.missio_placements![0]!.cant_make_it_at).toBe(now.toISOString());
  });

  it("joining adds the membership and closes the placement", async () => {
    const placed = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    if (!placed.ok) throw new Error(placed.code);
    const joined = await stepPlacement(auth, { mode: "all" }, placed.placement.id, { step: "joined" }, now);
    if (!joined.ok) throw new Error(joined.code);
    expect(joined.placement.joinedAt).toBe(now.toISOString());
    expect(joined.placement.saidHiAt).toBe(now.toISOString());
    expect(tables.house_church_members!.some((row) => row.contact_id === SIPHO && row.role === "member")).toBe(true);
    const again = await stepPlacement(auth, { mode: "all" }, placed.placement.id, { step: "cancel" }, now);
    expect(again.ok ? null : again.code).toBe("already_resolved");
  });

  it("keeps coaches to their own houses and rejects bad links", async () => {
    const placed = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    if (!placed.ok) throw new Error(placed.code);
    const other = await stepPlacement(auth, { mode: "houses", ids: ["elsewhere"] }, placed.placement.id, { step: "said_hi" }, now);
    expect(other.ok ? null : other.code).toBe("not_found");
    const bad = await personPage(db as never, "x".repeat(43), now);
    expect(bad.ok ? null : bad.code).toBe("invalid_token");
  });

  it("moves an open placement when they're placed somewhere else", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    tables.house_churches!.push({ id: OTHER, org_id: "org-missio", campus: "potch", number: 6, name: "Hilltop", meeting_day: "friday", location: null });
    await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    await createPlacement(auth, { contactId: SIPHO, houseId: OTHER }, now);
    const open = tables.missio_placements!.filter((row) => !row.cancelled_at);
    expect(open.map((row) => row.house_church_id)).toEqual([OTHER]);
  });
});

describe("placing a household", () => {
  it("places the other adults too and counts the children", async () => {
    tables.contacts!.push({ id: "c-kevin", first_name: "Kevin", last_name: "Dlamini", preferred_name: null, phone: null });
    tables.missio_household_members = [
      { id: "hm1", household_id: "hh1", kind: "adult", contact_id: SIPHO },
      { id: "hm2", household_id: "hh1", kind: "adult", contact_id: "c-kevin" },
      { id: "hm3", household_id: "hh1", kind: "child", contact_id: null },
    ];
    const result = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE, household: true }, now);
    if (!result.ok) throw new Error(result.code);
    expect(result.family).toEqual({ placed: 2, kids: 1 });
    expect(tables.missio_placements!.map((row) => row.contact_id).sort()).toEqual(["c-kevin", SIPHO].sort());
  });

  it("places just the person without the flag", async () => {
    tables.missio_household_members = [
      { id: "hm1", household_id: "hh1", kind: "adult", contact_id: SIPHO },
      { id: "hm2", household_id: "hh1", kind: "adult", contact_id: "c-kevin" },
    ];
    const result = await createPlacement(auth, { contactId: SIPHO, houseId: HOUSE }, now);
    expect(result.ok && result.family).toBe(null);
    expect(tables.missio_placements).toHaveLength(1);
  });
});
