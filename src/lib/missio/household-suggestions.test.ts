import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

// Made-up people only.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const missing = new Set<string>();
let failContact: string | null = null;

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row | null = null;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (missing.has(table)) return { error: { code: "PGRST205", message: "missing" } };
    if (action === "insert") {
      if (table === "missio_household_members" && failContact && payload!.contact_id === failContact) {
        return { error: { code: "23505", message: "duplicate" } };
      }
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

const { listSuggestions, reviewSuggestion } = await import("./household-suggestions");
const { createHousehold, addHouseholdMember } = await import("./households");

const ORG = "org-missio";
const GIDEON = "11111111-1111-4111-8111-111111111111";
const RILEY = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";
const auth = { supabase: db, orgId: ORG, user: { id: "pastor-1" } } as never;

function suggestion(id: string, a: string, b: string, status = "pending") {
  return { id, org_id: ORG, contact_a: a, contact_b: b, status, created_at: "2026-11-24T08:00:00Z", reviewed_by: null, reviewed_at: null };
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  missing.clear();
  failContact = null;
  tables.org_people = [
    { id: GIDEON, org_id: ORG, contact_id: "c-gideon" },
    { id: RILEY, org_id: ORG, contact_id: "c-riley" },
    { id: SAM, org_id: ORG, contact_id: "c-sam" },
  ];
  tables.contacts = [
    { id: "c-gideon", first_name: "Gideon", last_name: "Example", preferred_name: null, email: "g@example.test", phone: "+27000000001" },
    { id: "c-riley", first_name: "Riley", last_name: "Example", preferred_name: null, email: "r@example.test", phone: "+27000000002" },
    { id: "c-sam", first_name: "Sam", last_name: "Sample", preferred_name: null },
  ];
  tables.house_church_members = [
    { contact_id: "c-gideon", house_church_id: "h6", ended_at: null },
    { contact_id: "c-riley", house_church_id: "h6", ended_at: null },
  ];
  tables.house_churches = [{ id: "h6", org_id: ORG, number: 6, name: null }];
  tables.missio_household_suggestions = [suggestion("s1", "c-gideon", "c-riley")];
});

describe("listing", () => {
  it("gives first names, person ids and the shared house — no emails or phones", async () => {
    const out = await listSuggestions(auth);
    if (!out.ok) throw new Error(out.code);
    expect(out.suggestions).toEqual([
      { id: "s1", a: { personId: GIDEON, firstName: "Gideon" }, b: { personId: RILEY, firstName: "Riley" }, houseNumber: 6, link: "new" },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/example\.test|\+27|Example/);
  });

  it("only pending, only this person's when asked", async () => {
    tables.missio_household_suggestions!.push(suggestion("s2", "c-riley", "c-sam", "dismissed"));
    const mine = await listSuggestions(auth, { personId: SAM });
    expect(mine.ok && mine.suggestions).toEqual([]);
    const riley = await listSuggestions(auth, { personId: RILEY });
    expect(riley.ok && riley.suggestions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("is empty, not an error, before migration 398 is applied", async () => {
    missing.add("missio_household_suggestions");
    expect(await listSuggestions(auth)).toEqual({ ok: true, suggestions: [] });
  });

  it("leaves out a pair where one isn't a Missio person any more", async () => {
    tables.org_people = tables.org_people!.filter((row) => row.id !== RILEY);
    const out = await listSuggestions(auth);
    expect(out.ok && out.suggestions).toEqual([]);
  });
});

describe("Link household", () => {
  it("starts a household with both adults and marks the suggestion accepted", async () => {
    const out = await reviewSuggestion(auth, "s1", { action: "accept" });
    if (!out.ok) throw new Error(out.code);
    expect(out.household?.adults.map((adult) => adult.firstName).sort()).toEqual(["Gideon", "Riley"]);
    expect(out.household?.children).toEqual([]);
    expect(tables.missio_households).toHaveLength(1);
    expect(tables.missio_household_suggestions![0]).toMatchObject({ status: "accepted", reviewed_by: "pastor-1" });
  });

  it("asks before adding someone to a household that exists, then adds without removing anyone", async () => {
    const made = await createHousehold(auth, { personId: GIDEON });
    if (!made.ok) throw new Error(made.code);
    await addHouseholdMember(auth, made.household.id, { kind: "child", firstName: "Kid", birthYear: 2020 }, new Date("2026-11-24T08:00:00Z"));
    const first = await reviewSuggestion(auth, "s1", { action: "accept" });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe("household_exists");
    expect(first.existing).toEqual({ householdTitle: "The Examples", joiningPersonId: RILEY });
    expect(tables.missio_household_suggestions![0]!.status).toBe("pending");

    const second = await reviewSuggestion(auth, "s1", { action: "accept", addToExisting: true });
    if (!second.ok) throw new Error(second.code);
    expect(second.household?.id).toBe(made.household.id);
    expect(second.household?.adults.map((adult) => adult.firstName).sort()).toEqual(["Gideon", "Riley"]);
    expect(second.household?.children.map((child) => child.firstName)).toEqual(["Kid"]);
    expect(tables.missio_households).toHaveLength(1);
  });

  it("refuses when they're each in a different household, and changes neither", async () => {
    const g = await createHousehold(auth, { personId: GIDEON });
    const r = await createHousehold(auth, { personId: RILEY });
    if (!g.ok || !r.ok) throw new Error("setup");
    const before = JSON.stringify(tables.missio_household_members);
    const out = await reviewSuggestion(auth, "s1", { action: "accept", addToExisting: true });
    expect(out.ok ? null : out.code).toBe("both_in_households");
    expect(JSON.stringify(tables.missio_household_members)).toBe(before);
    expect(tables.missio_household_suggestions![0]!.status).toBe("pending");
  });

  it("marks it done when they're already in one household", async () => {
    const made = await createHousehold(auth, { personId: GIDEON });
    if (!made.ok) throw new Error(made.code);
    await addHouseholdMember(auth, made.household.id, { kind: "adult", personId: RILEY });
    const members = tables.missio_household_members!.length;
    const out = await reviewSuggestion(auth, "s1", { action: "accept" });
    expect(out.ok && out.status).toBe("accepted");
    expect(tables.missio_household_members).toHaveLength(members);
  });

  it("undoes the household it just started if the second adult can't be added", async () => {
    // Riley lands in another household between the read and the insert (a race).
    failContact = "c-riley";
    const out = await reviewSuggestion(auth, "s1", { action: "accept" });
    expect(out.ok).toBe(false);
    expect(tables.missio_households).toEqual([]);
    expect(tables.missio_household_suggestions![0]!.status).toBe("pending");
  });
});

describe("Not a couple", () => {
  it("dismisses without touching households", async () => {
    const out = await reviewSuggestion(auth, "s1", { action: "dismiss" });
    expect(out).toEqual({ ok: true, status: "dismissed", household: null });
    expect(tables.missio_households ?? []).toEqual([]);
    expect(tables.missio_household_suggestions![0]).toMatchObject({ status: "dismissed", reviewed_by: "pastor-1" });
  });

  it("a second answer is refused", async () => {
    await reviewSuggestion(auth, "s1", { action: "dismiss" });
    const again = await reviewSuggestion(auth, "s1", { action: "accept" });
    expect(again.ok ? null : again.code).toBe("already_resolved");
    expect(tables.missio_households ?? []).toEqual([]);
  });

  it("refuses a bad body and an unknown id", async () => {
    expect((await reviewSuggestion(auth, "s1", { action: "merge" })).ok).toBe(false);
    const unknown = await reviewSuggestion(auth, "nope", { action: "dismiss" });
    expect(unknown.ok ? null : unknown.code).toBe("not_found");
  });
});
