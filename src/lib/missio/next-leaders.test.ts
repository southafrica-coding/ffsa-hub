import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  let limitN = Infinity;
  const rows = () => (tables[table] ??= []);
  const run = (): { data?: Row[]; error?: { code: string; message: string } } => {
    if (action === "insert") {
      if (table === "missio_next_leaders" && rows().some((row) => row.contact_id === payload!.contact_id && !row.ended_at)) {
        return { error: { code: "23505", message: "dup" } };
      }
      const row = { id: `00000000-0000-4000-8000-00000000000${rows().length + 1}`, ended_at: null, ...payload };
      rows().push(row);
      return { data: [row] };
    }
    const hit = rows().filter((row) => filters.every((f) => f(row)));
    if (action === "update") for (const row of hit) Object.assign(row, payload);
    return { data: hit.slice(0, limitN) };
  };
  const b = {
    select: () => b,
    insert: (value: Row) => ((action = "insert"), (payload = value), b),
    update: (value: Row) => ((action = "update"), (payload = value), b),
    eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), b),
    is: (col: string, val: unknown) => (filters.push((row) => (row[col] ?? null) === val), b),
    in: (col: string, vals: unknown[]) => (filters.push((row) => vals.includes(row[col])), b),
    limit: (n: number) => ((limitN = n), b),
    maybeSingle: () => {
      const out = run();
      return Promise.resolve({ data: out.data?.[0] ?? null, error: out.error ?? null });
    },
    single: () => {
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
const { listNextLeaders, moveNextLeader, nextLeaderJourney, nominate } = await import("./next-leaders");

const H5 = "55555555-5555-4555-8555-555555555555";
const H4 = "44444444-4444-4444-8444-444444444444";
const MIA = "11111111-1111-4111-8111-111111111111";
const ESTHER = "22222222-2222-4222-8222-222222222222";
const DANIEL = "33333333-3333-4333-8333-333333333333";
const auth = { supabase: db, orgId: "org", user: { id: "u1" } } as never;
const all = { mode: "all" } as const;
const now = new Date("2026-11-19T08:00:00Z");

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  tables.house_churches = [
    { id: H5, org_id: "org", number: 5, name: null },
    { id: H4, org_id: "org", number: 4, name: null },
  ];
  tables.house_church_members = [
    { house_church_id: H5, contact_id: ESTHER, role: "leader", ended_at: null },
    { house_church_id: H5, contact_id: DANIEL, role: "co_leader", ended_at: null },
    { house_church_id: H5, contact_id: MIA, role: "member", ended_at: null },
  ];
  tables.org_people_directory = [
    { id: "p-mia", org_id: "org", contact_id: MIA, first_name: "Mia", last_name: "Grobler", preferred_name: null },
    { id: "p-esther", org_id: "org", contact_id: ESTHER, first_name: "Esther", last_name: "Naidoo", preferred_name: null },
    { id: "p-daniel", org_id: "org", contact_id: DANIEL, first_name: "Daniel", last_name: "Fourie", preferred_name: null },
  ];
  tables.missio_next_leaders = [];
});

describe("next leaders", () => {
  it("shows co-leaders as in training until someone moves them", async () => {
    const list = await listNextLeaders(auth, all);
    if (!list.ok) throw new Error(list.code);
    expect(list.leaders).toEqual([
      expect.objectContaining({ virtual: true, name: "Daniel Fourie", stage: "in_training", trainer: { contactId: ESTHER, name: "Esther Naidoo" } }),
    ]);
  });

  it("nominates someone in the house, with their trainer, then moves them along", async () => {
    const made = await nominate(auth, all, { contactId: MIA, houseId: H5, trainerContactId: ESTHER, note: "Natural host." }, now);
    if (!made.ok) throw new Error(made.code);
    const later = new Date("2026-12-01T08:00:00Z");
    await moveNextLeader(auth, all, made.id, { stage: "in_training" }, later);
    const row = tables.missio_next_leaders![0]!;
    expect(row).toMatchObject({ stage: "in_training", spotted_at: now.toISOString(), training_at: later.toISOString(), note: "Natural host." });
    const journey = await nextLeaderJourney(auth, MIA);
    expect(journey.map((step) => [step.stage, step.trainer])).toEqual([
      ["spotted", "Esther"],
      ["in_training", "Esther"],
    ]);
  });

  it("refuses someone not in the house, a house outside scope, and a second nomination", async () => {
    const outside = await nominate(auth, all, { contactId: MIA, houseId: H4 }, now);
    expect(outside.ok ? null : outside.code).toBe("membership_not_current");
    const scoped = await nominate(auth, { mode: "houses", ids: [H4] }, { contactId: MIA, houseId: H5 }, now);
    expect(scoped.ok ? null : scoped.code).toBe("not_found");
    await nominate(auth, all, { contactId: MIA, houseId: H5 }, now);
    const again = await nominate(auth, all, { contactId: MIA, houseId: H5 }, now);
    expect(again.ok ? null : again.code).toBe("conflict");
  });

  it("moving a co-leader card creates the row, and ready shows on the house", async () => {
    const moved = await moveNextLeader(auth, all, `co:${H5}:${DANIEL}`, { stage: "ready" }, now);
    if (!moved.ok) throw new Error(moved.code);
    const list = await listNextLeaders(auth, all);
    if (!list.ok) throw new Error(list.code);
    expect(list.leaders).toEqual([expect.objectContaining({ virtual: false, name: "Daniel Fourie", stage: "ready" })]);
    expect(list.houses.find((house) => house.id === H5)).toMatchObject({ memberCount: 3, ready: ["Daniel Fourie"] });
  });

  it("takes someone off the list", async () => {
    const made = await nominate(auth, all, { contactId: MIA, houseId: H5 }, now);
    if (!made.ok) throw new Error(made.code);
    await moveNextLeader(auth, all, made.id, { remove: true }, now);
    const list = await listNextLeaders(auth, all);
    expect(list.ok && list.leaders.map((leader) => leader.name)).toEqual(["Daniel Fourie"]);
  });
});
