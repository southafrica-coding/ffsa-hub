import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row | null = null;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (action === "insert") {
      if (table === "missio_household_members" && payload!.contact_id && rows().some((row) => row.contact_id === payload!.contact_id)) {
        return { error: { code: "23505", message: "duplicate" } };
      }
      const row = { id: `${table}-${rows().length + 1}`, created_at: `2026-11-19T08:00:0${rows().length}Z`, ...payload };
      rows().push(row);
      return { data: [row] };
    }
    const hit = rows().filter((row) => filters.every((f) => f(row)));
    if (action === "update") for (const row of hit) Object.assign(row, payload);
    if (action === "delete") {
      tables[table] = rows().filter((row) => !hit.includes(row));
      if (table === "missio_households") {
        tables.missio_household_members = (tables.missio_household_members ?? []).filter((m) => !hit.some((h) => h.id === m.household_id));
      }
    }
    return { data: hit };
  };
  const b = {
    select: () => b,
    insert: (value: Row) => ((action = "insert"), (payload = value), b),
    update: (value: Row) => ((action = "update"), (payload = value), b),
    delete: () => ((action = "delete"), b),
    eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), b),
    is: (col: string, val: unknown) => (filters.push((row) => (row[col] ?? null) === val), b),
    in: (col: string, vals: unknown[]) => (filters.push((row) => vals.includes(row[col])), b),
    order: () => b,
    limit: () => b,
    maybeSingle: () => {
      const out = run();
      return Promise.resolve({ data: out.data?.[0] ?? null, error: out.error ?? null });
    },
    then: (resolve: (value: unknown) => unknown) => {
      const out = run();
      return Promise.resolve({ data: out.data ?? null, error: out.error ?? null }).then(resolve);
    },
  };
  return b;
}
const db = { from };

const { addHouseholdMember, createHousehold, householdForPerson, householdTitle, listHouseholds, removeHouseholdMember, updateHousehold } =
  await import("./households");

const ESTHER = "11111111-1111-4111-8111-111111111111";
const JOHAN = "22222222-2222-4222-8222-222222222222";
const auth = { supabase: db, orgId: "org-missio", user: { id: "pastor-1" } } as never;
const now = new Date("2026-11-19T08:00:00Z");

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  tables.org_people = [
    { id: ESTHER, org_id: "org-missio", contact_id: "c-esther" },
    { id: JOHAN, org_id: "org-missio", contact_id: "c-johan" },
  ];
  tables.contacts = [
    { id: "c-esther", first_name: "Esther", last_name: "Naidoo", preferred_name: null },
    { id: "c-johan", first_name: "Johan", last_name: "Naidoo", preferred_name: null },
  ];
  tables.house_church_members = [{ contact_id: "c-johan", house_church_id: "h5", ended_at: null }];
  tables.house_churches = [{ id: "h5", org_id: "org-missio", number: 5, name: null }];
});

describe("household titles", () => {
  it("names a family from the shared surname", () => {
    expect(householdTitle(null, [{ name: "Esther Naidoo" }, { name: "Johan Naidoo" }], [])).toBe("The Naidoos");
    expect(householdTitle(null, [{ name: "Anna Botha" }], [{ lastName: "Botha" }])).toBe("The Botha family");
    expect(householdTitle(null, [{ name: "Ayesha Daniels" }], [])).toBe("Ayesha Daniels");
    expect(householdTitle(null, [{ name: "Lerato Dube" }, { name: "Sam Khumalo" }], [])).toBe("Lerato Dube & Sam Khumalo");
    expect(householdTitle("The Pillay crew", [], [])).toBe("The Pillay crew");
  });
});

describe("households", () => {
  it("builds a family: two adults, a child, one main contact and one greeting", async () => {
    const made = await createHousehold(auth, { personId: ESTHER });
    if (!made.ok) throw new Error(made.code);
    const id = made.household.id;
    const withJohan = await addHouseholdMember(auth, id, { kind: "adult", personId: JOHAN, label: "husband" }, now);
    if (!withJohan.ok) throw new Error(withJohan.code);
    const withSam = await addHouseholdMember(auth, id, { kind: "child", firstName: "Sam", lastName: "Naidoo", birthYear: 2021 }, now);
    if (!withSam.ok) throw new Error(withSam.code);
    const family = withSam.household;
    expect(family.title).toBe("The Naidoos");
    expect(family.greeting).toBe("Hi Esther & Johan");
    expect(family.adults.map((adult) => [adult.name, adult.main, adult.label])).toEqual([
      ["Esther Naidoo", true, null],
      ["Johan Naidoo", false, "husband"],
    ]);
    expect(family.adults[1]!.houses).toEqual([{ id: "h5", number: 5, name: null }]);
    expect(family.children).toEqual([{ memberId: expect.any(String), firstName: "Sam", lastName: "Naidoo", birthYear: 2021 }]);

    const found = await householdForPerson(auth, JOHAN);
    expect(found.ok && found.household?.id).toBe(id);
  });

  it("keeps an adult in one household and refuses a future birth year", async () => {
    const a = await createHousehold(auth, { personId: ESTHER });
    const b = await createHousehold(auth, { personId: JOHAN });
    if (!a.ok || !b.ok) throw new Error("setup");
    const moved = await addHouseholdMember(auth, a.household.id, { kind: "adult", personId: JOHAN }, now);
    expect(moved.ok ? null : moved.code).toBe("in_other_household");
    const future = await addHouseholdMember(auth, a.household.id, { kind: "child", firstName: "Zoe", birthYear: 2030 }, now);
    expect(future.ok ? null : future.code).toBe("invalid_input");
  });

  it("moves the main contact when they leave, and ends the household with the last adult", async () => {
    const made = await createHousehold(auth, { personId: ESTHER });
    if (!made.ok) throw new Error(made.code);
    const id = made.household.id;
    const both = await addHouseholdMember(auth, id, { kind: "adult", personId: JOHAN }, now);
    if (!both.ok) throw new Error(both.code);
    const esther = both.household.adults.find((adult) => adult.main)!;
    const after = await removeHouseholdMember(auth, id, esther.memberId);
    if (!after.ok) throw new Error(after.code);
    expect(after.household?.adults.map((adult) => [adult.name, adult.main])).toEqual([["Johan Naidoo", true]]);
    const ended = await removeHouseholdMember(auth, id, after.household!.adults[0]!.memberId);
    expect(ended.ok && ended.household).toBe(null);
    const list = await listHouseholds(auth);
    expect(list.ok && list.households).toEqual([]);
  });

  it("only lets an adult in the household be the main contact", async () => {
    const made = await createHousehold(auth, { personId: ESTHER });
    if (!made.ok) throw new Error(made.code);
    const wrong = await updateHousehold(auth, made.household.id, { mainContactId: "33333333-3333-4333-8333-333333333333" });
    expect(wrong.ok ? null : wrong.code).toBe("invalid_input");
    const named = await updateHousehold(auth, made.household.id, { name: "The Naidoo clan" });
    expect(named.ok && named.household.title).toBe("The Naidoo clan");
  });
});
