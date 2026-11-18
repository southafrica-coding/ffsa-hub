import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const adminReads: string[] = [];

function client(log?: string[]) {
  return {
    from(table: string) {
      log?.push(table);
      const filters: Array<(row: Row) => boolean> = [];
      const b = {
        select: () => b,
        eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), b),
        in: (col: string, vals: unknown[]) => (filters.push((row) => vals.includes(row[col])), b),
        rows: () => (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row))),
        maybeSingle: () => Promise.resolve({ data: b.rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: b.rows(), error: null }).then(resolve),
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client(adminReads) }));

const { getPersonProfile } = await import("./profile");

const ORG = "org-missio";
const auth = { supabase: client(), orgId: ORG, user: { id: "pastor" } } as never;

beforeEach(() => {
  adminReads.length = 0;
  for (const key of Object.keys(tables)) delete tables[key];
  tables.org_people_directory = [
    { id: "p1", org_id: ORG, contact_id: "c1", campus: "potch", status: "active", joined_at: "2026-03-19", first_name: "Kea", last_name: "Molefe" },
  ];
  tables.org_people = [{ id: "p1", org_id: ORG, created_at: "2026-03-01T08:00:00Z" }];
  tables.contacts = [{ id: "c1", email: "kea.molefe@gmail.com", phone: "0825550142" }];
  tables.house_churches = [
    { id: "h4", org_id: ORG, number: 4, name: null },
    { id: "h2", org_id: ORG, number: 2, name: "River Room" },
  ];
  tables.house_church_members = [
    { id: "m1", house_church_id: "h2", contact_id: "c1", role: "member", started_at: "2026-03-19", ended_at: "2026-08-31" },
    { id: "m2", house_church_id: "h4", contact_id: "c1", role: "co_leader", started_at: "2026-09-01", ended_at: null },
    { id: "m3", house_church_id: "h4", contact_id: "someone-else", role: "member", started_at: "2026-01-01", ended_at: null },
  ];
  tables.missio_followups = [{ id: "f1", org_id: ORG, contact_id: "c1", connect_response_id: "r1" }];
  tables.missio_followup_stage_history = [
    { id: "s0", followup_id: "f1", kind: "stage_change", to_stage: "new", changed_at: "2026-03-01T09:00:00Z", notes: null },
    { id: "s1", followup_id: "f1", kind: "stage_change", to_stage: "contacted", changed_at: "2026-03-03T09:00:00Z", notes: null },
    { id: "s2", followup_id: "f1", kind: "note", to_stage: null, changed_at: "2026-03-04T09:00:00Z", notes: "Called, keen." },
  ];
  tables.connect_responses = [
    { id: "r1", org_id: ORG, submitted_at: "2026-03-01T07:00:00Z", visit_type: "first_time", wants_house_church: true, wants_prayer: true, prayer_request: "private", matched_contact_id: "c1" },
  ];
});

describe("getPersonProfile", () => {
  it("builds houses and a newest-first journey from existing rows", async () => {
    const result = await getPersonProfile(auth, "p1");
    if (!result.ok) throw new Error("expected a profile");
    const { profile } = result;
    expect(profile.person).toMatchObject({ id: "p1", name: "Kea Molefe" });
    expect(profile.houses.map((house) => [house.number, house.role, house.endedAt])).toEqual([
      [4, "co_leader", null],
      [2, "member", "2026-08-31"],
    ]);
    expect(profile.journey.map((event) => event.type)).toEqual([
      "joined_house",
      "left_house",
      "joined_house",
      "followup_note",
      "followup_stage",
      "added",
      "connect_card",
    ]);
    expect(profile.journey.at(-1)).toMatchObject({ visitType: "first_time", wantsHouseChurch: true, wantsPrayer: true });
  });

  it("masks contact details and never returns the prayer request", async () => {
    const result = await getPersonProfile(auth, "p1");
    if (!result.ok) throw new Error("expected a profile");
    const text = JSON.stringify(result.profile);
    expect(text).not.toContain("kea.molefe@gmail.com");
    expect(text).not.toContain("0825550142");
    expect(text).not.toContain("private");
    expect(result.profile.contact.phone).toContain("0142");
    expect(adminReads).toEqual(["contacts"]);
  });

  it("answers 404 for someone outside the org", async () => {
    const result = await getPersonProfile(auth, "nope");
    expect(result).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(adminReads).toEqual([]);
  });
});
