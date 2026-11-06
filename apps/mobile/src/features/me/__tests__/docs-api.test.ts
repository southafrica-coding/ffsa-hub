import {
  confirmInsurance,
  deletePolicyRecord,
  getCv,
  getHousehold,
  getInsurance,
  getLicence,
  getPassport,
  leaveHousehold,
  removeDocFile,
  removeMember,
  removeNextPolicy,
  saveCurrentPolicy,
  saveEssence,
  saveLicence,
  saveMember,
  saveNextPolicy,
  uploadDocPhoto,
  type Db,
} from "../docs-api";
import type { ProfileFetch } from "../http";

jest.mock("@/features/bookings/client", () => ({ bookingsFetch: jest.fn().mockResolvedValue({ ok: true }) }));

type Call = { path: string; init?: Record<string, unknown> };

function fakeFetch(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const f = (async (path: string, init?: Record<string, unknown>) => {
    calls.push({ path, init });
    const value = answers[path] ?? { ok: true };
    const schema = init?.schema as { parse: (v: unknown) => unknown } | undefined;
    return schema ? schema.parse(value) : value;
  }) as unknown as ProfileFetch;
  return { f, calls };
}

/** A Supabase stand-in: every chain method returns itself; awaiting gives the table's answer. */
function fakeDb(tables: Record<string, { data: unknown; error: unknown }>) {
  const seen: { table: string; select?: string; eq: unknown[][] }[] = [];
  const db: Db = {
    from(table: string) {
      const rec = { table, select: undefined as string | undefined, eq: [] as unknown[][] };
      seen.push(rec);
      const answer = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: (cols: string) => ((rec.select = cols), chain),
        eq: (...a: unknown[]) => (rec.eq.push(a), chain),
        order: () => chain,
        maybeSingle: () => chain,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer).then(res, rej),
      };
      return chain;
    },
  };
  return { db, seen };
}

describe("licence + passport", () => {
  it("reads the licence (no storage path ever reaches the phone)", async () => {
    const { f, calls } = fakeFetch({
      "/api/profile/licence": {
        licence: { drivers_licence_number: "L1", licence_expiry_date: "2028-01-01", has_file: true, signed_url: "https://x", base_driving_test_status: null },
      },
    });
    const l = await getLicence(f);
    expect(calls[0].path).toBe("/api/profile/licence");
    expect(l).toMatchObject({ drivers_licence_number: "L1", has_file: true, base_driving_test_status: "not_required", licence_code: null });
    expect(l).not.toHaveProperty("licence_file_url");
  });

  it("saves typed details with PUT", async () => {
    const { f, calls } = fakeFetch();
    await saveLicence(f, { number: " L1 ", country: "ZA", code: " B ", expiry: "2028-01-01" });
    expect(calls[0]).toMatchObject({
      path: "/api/profile/licence",
      init: { method: "PUT", body: { drivers_licence_number: "L1", licence_country: "ZA", licence_code: "B", licence_expiry_date: "2028-01-01" } },
    });
  });

  it("uploads a photo as multipart with a generic name and a long timeout; removes with DELETE", async () => {
    const { f, calls } = fakeFetch({ "/api/profile/passport-photo": { ok: true, file_name: "passport.jpg", signed_url: "https://s" } });
    const res = await uploadDocPhoto(f, "passport-photo", { uri: "file:///cache/p.jpg", name: "passport.jpg", type: "image/jpeg" });
    expect(res).toEqual({ file_name: "passport.jpg", signed_url: "https://s" });
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(calls[0].init?.timeoutMs).toBeGreaterThan(15_000);
    await removeDocFile(f, "licence");
    expect(calls[1]).toMatchObject({ path: "/api/profile/licence", init: { method: "DELETE" } });
  });

  it("reads the passport photo state", async () => {
    const { f } = fakeFetch({ "/api/profile/passport-photo": { passport: { has_file: false } } });
    expect(await getPassport(f)).toEqual({ has_file: false, file_name: null, uploaded_at: null, signed_url: null });
  });
});

describe("insurance", () => {
  it("reads the own row, history and the provider list", async () => {
    const { db, seen } = fakeDb({
      users: {
        data: {
          health_insurance_provider: "Bonitas",
          health_insurance_policy_number: "P1",
          health_insurance_expiry_date: "2027-01-01",
          health_insurance_no_expiry: false,
          next_health_insurance_provider: "GEMS",
          next_health_insurance_expiry_date: "2028-01-01",
          next_health_insurance_no_expiry: false,
        },
        error: null,
      },
      user_insurance_policies: {
        data: [{ id: "p1", provider: "Bonitas", policy_number: "P1", expiry_date: "2027-01-01", no_expiry: false, recorded_at: "2026-01-01T00:00:00Z" }],
        error: null,
      },
      list_options: { data: [{ value: "GEMS", label: "GEMS" }], error: null },
    });
    const data = await getInsurance(db, "u1");
    expect(data.current).toEqual({ provider: "Bonitas", policyNumber: "P1", expiryDate: "2027-01-01", noExpiry: false, confirmedAt: null });
    expect(data.next).toMatchObject({ provider: "GEMS", expiryDate: "2028-01-01" });
    expect(data.history).toHaveLength(1);
    expect(data.providers).toEqual([{ value: "GEMS", label: "GEMS" }]);
    // own rows only
    expect(seen.find((s) => s.table === "users")?.eq).toEqual([["id", "u1"]]);
    expect(seen.find((s) => s.table === "user_insurance_policies")?.eq).toEqual([["user_id", "u1"]]);
  });

  it("an unreadable provider list falls back quietly; a failed own-row read is an error", async () => {
    const ok = fakeDb({ list_options: { data: null, error: { message: "nope" } } });
    expect((await getInsurance(ok.db, "u1")).providers).toEqual([]);
    const bad = fakeDb({ users: { data: null, error: { message: "boom" } } });
    await expect(getInsurance(bad.db, "u1")).rejects.toThrow("boom");
  });

  it("writes go through the web's routes", async () => {
    const { f, calls } = fakeFetch();
    await saveCurrentPolicy(f, { health_insurance_provider: "Bonitas" });
    await confirmInsurance(f);
    await saveNextPolicy(f, { provider: "GEMS" });
    await removeNextPolicy(f);
    await deletePolicyRecord(f, "p/1");
    expect(calls.map((c) => [c.init?.method, c.path])).toEqual([
      ["PUT", "/api/profile/update"],
      ["POST", "/api/profile/insurance-confirm"],
      ["PUT", "/api/profile/insurance-next"],
      ["DELETE", "/api/profile/insurance-next"],
      ["DELETE", "/api/profile/insurance-policies/p%2F1"],
    ]);
  });
});

describe("household", () => {
  it("lists members from the API and own details from RLS", async () => {
    const { f, calls } = fakeFetch({ "/api/profile/household": { members: [{ id: "m1", relationship: "child", full_name: "Sam" }] } });
    const { db } = fakeDb({ users: { data: { marital_status: "married", household_linked_at: "2026-01-01" }, error: null } });
    const h = await getHousehold(f, db, "u1");
    expect(calls[0].path).toBe("/api/profile/household");
    expect(h.members[0]).toMatchObject({ id: "m1", full_name: "Sam", is_international: false });
    expect(h.self).toMatchObject({ marital_status: "married", household_linked_at: "2026-01-01" });
  });

  it("add = POST, edit = PUT, remove = DELETE, leave = DELETE link", async () => {
    const member = { member: { id: "m9", relationship: "child", full_name: "Sam" } };
    const { f, calls } = fakeFetch({ "/api/profile/household": member, "/api/profile/household/m9": member });
    expect((await saveMember(f, null, { full_name: "Sam" })).id).toBe("m9");
    await saveMember(f, "m9", { full_name: "Sam" });
    await removeMember(f, "m9");
    await leaveHousehold(f);
    expect(calls.map((c) => [c.init?.method, c.path])).toEqual([
      ["POST", "/api/profile/household"],
      ["PUT", "/api/profile/household/m9"],
      ["DELETE", "/api/profile/household/m9"],
      ["DELETE", "/api/profile/household/link"],
    ]);
  });
});

describe("staff CV", () => {
  it("reads own essence, job description and entries; saves essence with PATCH", async () => {
    const { db } = fakeDb({
      users: { data: { essence_statement: "Hi", job_description: null }, error: null },
      staff_cv_entries: { data: [{ id: "e1", category: "skill", title: "Sound", added_by_role: "self" }], error: null },
    });
    expect(await getCv(db, "u1")).toMatchObject({ essence: "Hi", jobDescription: "", entries: [{ id: "e1", title: "Sound" }] });
    const { f, calls } = fakeFetch();
    await saveEssence(f, "  New  ");
    expect(calls[0]).toMatchObject({ path: "/api/profile/cv", init: { method: "PATCH", body: { essence_statement: "New" } } });
    expect(calls[0].init?.body).not.toHaveProperty("userId");
  });
});

describe("profileFetch", () => {
  it("hands PUT straight to the shared bookings request helper", async () => {
    const { bookingsFetch } = jest.requireMock("@/features/bookings/client") as { bookingsFetch: jest.Mock };
    const { profileFetch } = jest.requireActual("../http") as typeof import("../http");
    await profileFetch("/api/profile/update", { method: "PUT", body: { a: 1 } });
    expect(bookingsFetch).toHaveBeenCalledWith("/api/profile/update", { method: "PUT", body: { a: 1 } });
  });
});
