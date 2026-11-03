import { describe, it, expect } from "vitest";
import { changedFields, describeUnitChanges, isIsoDate, validateUnitEdit } from "./unit-edit";

const LOC = "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

describe("validateUnitEdit", () => {
  it("accepts every editable field and cleans text", () => {
    const r = validateUnitEdit({
      label: "  PM3 ",
      serial: "",
      condition: "Working",
      condition_note: null,
      supplier: "MSM Productions",
      purchase_date: "2025-02-28",
      purchase_price_cents: 125050,
      warranty_until: "",
      last_checked_on: "2026-11-02",
      location_id: LOC,
      owner_label: "SBS School",
      status: "retired",
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        label: "PM3",
        serial: null,
        condition: "Working",
        condition_note: null,
        supplier: "MSM Productions",
        purchase_date: "2025-02-28",
        purchase_price_cents: 125050,
        warranty_until: null,
        last_checked_on: "2026-11-02",
        location_id: LOC,
        owner_label: "SBS School",
        status: "retired",
      },
    });
  });

  it("returns only the fields that were sent", () => {
    expect(validateUnitEdit({ condition: "Broken" })).toEqual({ ok: true, patch: { condition: "Broken" } });
  });

  it("refuses fields it doesn't edit", () => {
    for (const key of ["tag", "product_id", "id", "tag_printed_at", "source", "owner_ministry_id"]) {
      const r = validateUnitEdit({ [key]: "x" });
      expect(r.ok).toBe(false);
    }
  });

  it("refuses statuses a person can't set", () => {
    expect(validateUnitEdit({ status: "out" }).ok).toBe(false);
    expect(validateUnitEdit({ status: "reserved" }).ok).toBe(false);
    expect(validateUnitEdit({ status: null }).ok).toBe(false);
  });

  it("refuses bad dates, money and locations", () => {
    expect(validateUnitEdit({ purchase_date: "2026-02-30" }).ok).toBe(false);
    expect(validateUnitEdit({ last_checked_on: "30/04/2026" }).ok).toBe(false);
    expect(validateUnitEdit({ purchase_price_cents: 12.5 }).ok).toBe(false);
    expect(validateUnitEdit({ purchase_price_cents: -1 }).ok).toBe(false);
    expect(validateUnitEdit({ purchase_price_cents: "1200" }).ok).toBe(false);
    expect(validateUnitEdit({ location_id: "auditorium" }).ok).toBe(false);
    expect(validateUnitEdit({ label: 12 }).ok).toBe(false);
    expect(validateUnitEdit({ condition_note: "x".repeat(2001) }).ok).toBe(false);
  });

  it("refuses a body that isn't an object", () => {
    expect(validateUnitEdit(null).ok).toBe(false);
    expect(validateUnitEdit([]).ok).toBe(false);
    expect(validateUnitEdit("status=retired").ok).toBe(false);
  });

  it("clears a location or price with null or blank", () => {
    expect(validateUnitEdit({ location_id: "", purchase_price_cents: null })).toEqual({
      ok: true,
      patch: { location_id: null, purchase_price_cents: null },
    });
  });
});

describe("isIsoDate", () => {
  it("knows real days", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });
});

describe("changedFields + describeUnitChanges", () => {
  const current = {
    condition: "Broken",
    serial: null,
    location_id: null,
    purchase_price_cents: null,
    last_checked_on: "2026-04-30",
    status: "maintenance",
  };

  it("keeps only real changes (null and missing are the same)", () => {
    expect(
      changedFields(current, { condition: "Broken", serial: null, status: "available", owner_label: null })
    ).toEqual({ status: "available" });
  });

  it("writes one plain line per change", () => {
    const changes = changedFields(current, {
      condition: "Working",
      location_id: LOC,
      purchase_price_cents: 125000,
      last_checked_on: "2026-11-02",
      status: "available",
    });
    expect(describeUnitChanges(current, changes, (id) => (id === LOC ? "SBS Classroom" : undefined))).toEqual([
      "Condition: “Broken” → “Working”",
      "Location: none → SBS Classroom",
      "Purchase price: none → R 1 250.00",
      "Last checked: 30 Apr 2026 → 2 Nov 2026",
      "Status: “maintenance” → “available”",
    ]);
  });
});
