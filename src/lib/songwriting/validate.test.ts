import { describe, expect, it } from "vitest";
import {
  cleanList,
  dateFitsMonth,
  likePattern,
  parseEventCreate,
  parseIsoCode,
  parseLeadCreate,
  parseLeadFilters,
  parseLeadPatch,
  parseNationCreate,
  parseTrainingCreate,
  parseTrainingPatch,
  slugify,
} from "./validate";

const ME = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-000000000002";

describe("nations", () => {
  it("upper-cases and trims ISO codes; blank is null; anything else is refused", () => {
    expect(parseIsoCode(" za ")).toEqual({ ok: true, value: "ZA" });
    expect(parseIsoCode("")).toEqual({ ok: true, value: null });
    expect(parseIsoCode(null)).toEqual({ ok: true, value: null });
    for (const v of ["ZAF", "Z", "Z1", 12]) expect(parseIsoCode(v).ok).toBe(false);
  });

  it("cleans languages: trimmed, no blanks, no case-insensitive repeats", () => {
    expect(cleanList(["  Swahili ", "", "swahili", "English  UK"])).toEqual({ ok: true, value: ["Swahili", "English UK"] });
    expect(cleanList("Swahili").ok).toBe(false);
  });

  it("derives a slug from the name when none is sent", () => {
    const r = parseNationCreate({ name: "Côte d'Ivoire", iso_code: "ci", languages: ["French"] });
    expect(r).toEqual({ ok: true, value: { name: "Côte d'Ivoire", slug: "cote-d-ivoire", iso_code: "CI", languages: ["French"] } });
    expect(slugify("  ")).toBe("");
    expect(parseNationCreate({ name: "!!!" })).toMatchObject({ ok: false, field: "slug" });
    expect(parseNationCreate({ name: "X", iso_code: "XYZ" })).toMatchObject({ ok: false, field: "iso_code" });
  });
});

describe("trainings: the month and date rule", () => {
  const input = { audience_label: "Leaders", year: 2026, month: 3, languages: [], facilitators: ["A", " A ", "B"] };

  it("accepts a date inside the month and de-duplicates facilitators", () => {
    const r = parseTrainingCreate({ ...input, training_date: "2026-03-31" });
    expect(r.ok && r.value.row.training_date).toBe("2026-03-31");
    expect(r.ok && r.value.facilitators!.map((f) => f.display_name)).toEqual(["A", "B"]);
  });

  it("refuses a date outside the month with training_date_outside_month", () => {
    expect(parseTrainingCreate({ ...input, training_date: "2026-04-01" })).toMatchObject({ ok: false, field: "training_date", code: "training_date_outside_month" });
  });

  it("refuses timestamps and impossible dates", () => {
    for (const d of ["2026-03-14T10:00:00Z", "2026-02-30", "14/03/2026"]) expect(parseTrainingCreate({ ...input, month: 2, training_date: d })).toMatchObject({ ok: false, field: "training_date" });
  });

  it("refuses source, import_key and created_by", () => {
    expect(parseTrainingCreate({ ...input, source: "imported" })).toMatchObject({ ok: false, code: "read_only_field", field: "source" });
  });

  it("a PATCH that moves the month must move or clear the stored date", () => {
    const current = { year: 2026, month: 3, training_date: "2026-03-14" };
    expect(parseTrainingPatch({ month: 4 }, current)).toMatchObject({ ok: false, field: "training_date", code: "training_date_outside_month" });
    expect(parseTrainingPatch({ month: 4, training_date: "2026-04-02" }, current)).toMatchObject({ ok: true, value: { row: { month: 4, training_date: "2026-04-02" }, facilitators: null } });
    expect(parseTrainingPatch({ month: 4, training_date: null }, current)).toMatchObject({ ok: true, value: { row: { month: 4, training_date: null } } });
    expect(parseTrainingPatch({ month: 4 }, { ...current, training_date: null })).toMatchObject({ ok: true });
    expect(parseTrainingPatch({}, current)).toMatchObject({ ok: false });
  });

  it("dateFitsMonth", () => {
    expect(dateFitsMonth(null, 2026, 3)).toBe(true);
    expect(dateFitsMonth("2026-03-01", 2026, 3)).toBe(true);
    expect(dateFitsMonth("2025-03-01", 2026, 3)).toBe(false);
  });
});

describe("leads", () => {
  it("needs a label; refuses last_contact_at, created_by and owner_name", () => {
    expect(parseLeadCreate({ kind: "person" })).toMatchObject({ ok: false, field: "label" });
    expect(parseLeadCreate({ label: "X", last_contact_at: "2026-01-01" })).toMatchObject({ ok: false, field: "last_contact_at", code: "read_only_field" });
    expect(parseLeadPatch({ created_by: ME })).toMatchObject({ ok: false, field: "created_by", code: "read_only_field" });
    expect(parseLeadPatch({ owner_name: "x" })).toMatchObject({ ok: false, field: "owner_name" });
  });

  it("checks kind, status and ids", () => {
    expect(parseLeadCreate({ label: "X", kind: "family" })).toMatchObject({ ok: false, field: "kind" });
    expect(parseLeadPatch({ status: "done" })).toMatchObject({ ok: false, field: "status" });
    expect(parseLeadPatch({ nation_id: "nope" })).toMatchObject({ ok: false, field: "nation_id" });
    expect(parseLeadPatch({ status: "closed", owner_user_id: null })).toEqual({ ok: true, value: { status: "closed", owner_user_id: null } });
  });

  it("parses list filters; owner=me is the caller", () => {
    const f = parseLeadFilters(new URLSearchParams(`status=new,waiting&kind=group&nation_id=${ID}&owner=me&q=%20choir%20&limit=10`), ME);
    expect(f).toEqual({ ok: true, value: { status: ["new", "waiting"], kind: "group", nation_id: ID, source_training_id: null, contact_user_id: null, owner: ME, q: "choir", limit: 10 } });
    expect(parseLeadFilters(new URLSearchParams("owner=none"), ME)).toMatchObject({ ok: true, value: { owner: "none" } });
    expect(parseLeadFilters(new URLSearchParams("status=open"), ME)).toMatchObject({ ok: false, field: "status" });
    expect(parseLeadFilters(new URLSearchParams("limit=0"), ME)).toMatchObject({ ok: false, field: "limit" });
  });

  it("escapes LIKE wildcards in q", () => {
    expect(likePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});

describe("lead events", () => {
  const now = new Date("2026-11-27T05:00:00Z");
  it("needs a note; at is optional, ISO, not in the future; by is refused", () => {
    expect(parseEventCreate({ note: "  Called  " }, now)).toEqual({ ok: true, value: { note: "Called" } });
    expect(parseEventCreate({ note: "x", at: "2026-11-20T10:00:00+02:00" }, now)).toEqual({ ok: true, value: { note: "x", at: "2026-11-20T08:00:00.000Z" } });
    expect(parseEventCreate({ note: "x", at: "2026-12-01T00:00:00Z" }, now)).toMatchObject({ ok: false, field: "at" });
    expect(parseEventCreate({ note: "x", at: "yesterday" }, now)).toMatchObject({ ok: false, field: "at" });
    expect(parseEventCreate({ note: " " }, now)).toMatchObject({ ok: false, field: "note" });
    expect(parseEventCreate({ note: "x", by: ME }, now)).toMatchObject({ ok: false, field: "by", code: "read_only_field" });
  });
});
