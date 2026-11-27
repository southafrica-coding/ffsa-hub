import { describe, expect, it } from "vitest";
import { cleanEmbassy, embassyFacts, embassyLabel, embassyLetterDefaults, type Embassy } from "./embassies";
import { cleanStandingDocument, standingDueOn, standingNeedingAttention, standingState, type StandingDocument } from "./standing";

// Made-up missions: legal enters the real ones in the Hub.
const base: Embassy = {
  id: "e1",
  country_iso: "KE",
  name: "Test High Commission",
  city: "Testville",
  addressee: "The High Commissioner",
  accepts_scan: null,
  needs_original: null,
  blank_pages: null,
  processing_weeks: null,
  appointment_weeks: null,
  website_url: null,
  notes: null,
  is_active: true,
};

describe("cleanEmbassy", () => {
  const good = { country_iso: "ke", name: " Test High Commission ", city: "Testville", processing_weeks: "6", accepts_scan: true };

  it("accepts and tidies a good profile", () => {
    const r = cleanEmbassy(good);
    expect("data" in r && r.data).toMatchObject({
      country_iso: "KE",
      name: "Test High Commission",
      processing_weeks: 6,
      accepts_scan: true,
      needs_original: null,
      addressee: null,
      is_active: true,
    });
  });

  it("names the first problem", () => {
    expect(cleanEmbassy({ ...good, country_iso: "XX" })).toEqual({ error: "Pick the country the embassy is in" });
    expect(cleanEmbassy({ ...good, city: "  " })).toEqual({ error: "Give the city" });
    expect(cleanEmbassy({ ...good, website_url: "http://x.org" })).toEqual({ error: "The link must start with https://" });
    expect(cleanEmbassy({ ...good, processing_weeks: 0 })).toEqual({ error: "Processing time must be 1 to 52 weeks" });
    expect(cleanEmbassy({ ...good, blank_pages: 2.5 })).toEqual({ error: "Blank pages must be a whole number from 0 to 10" });
    expect(cleanEmbassy({ ...good, accepts_scan: "yes" })).toEqual({ error: "Scan and original must be yes, no or not known" });
  });
});

describe("embassy facts", () => {
  it("says only what's known", () => {
    expect(embassyFacts(base)).toEqual([]);
    expect(embassyFacts({ ...base, accepts_scan: true, blank_pages: 1, processing_weeks: 6, appointment_weeks: 2 })).toEqual([
      "A scan of the signed letters is accepted.",
      "The passport needs 1 blank page.",
      "Processing takes about 6 weeks, plus about 2 for an appointment.",
    ]);
    expect(embassyFacts({ ...base, accepts_scan: true, needs_original: true })[0]).toBe(
      "Take the original signed letters; a scan isn't enough."
    );
  });

  it("labels and fills the letter fields", () => {
    expect(embassyLabel(base)).toBe("Test High Commission, Testville (Kenya)");
    expect(embassyLetterDefaults(base)).toEqual({ mission_city: "Testville", addressee: "The High Commissioner" });
    expect(embassyLetterDefaults({ addressee: null, city: "Testville" })).toEqual({ mission_city: "Testville" });
    expect(embassyLetterDefaults(null)).toEqual({});
  });
});

describe("standing documents", () => {
  const doc: StandingDocument = {
    id: "d1",
    label: "Certified ID",
    description: null,
    certified_on: "2026-10-01",
    renew_months: 3,
    expires_on: null,
    for_students: false,
    sort_order: 0,
    is_active: true,
    storage_path: "standing/d1.pdf",
    mime_type: "application/pdf",
    file_uploaded_at: null,
  };

  it("works out when it runs out", () => {
    expect(standingDueOn(doc)).toBe("2027-01-01");
    expect(standingDueOn({ ...doc, expires_on: "2026-12-01" })).toBe("2026-12-01");
    expect(standingDueOn({ certified_on: null, renew_months: null, expires_on: null })).toBeNull();
  });

  it("says what state it's in", () => {
    expect(standingState(doc, "2026-11-01")).toBe("ok");
    expect(standingState(doc, "2026-12-05")).toBe("soon");
    expect(standingState(doc, "2027-01-01")).toBe("expired");
    expect(standingState({ ...doc, storage_path: null }, "2026-11-01")).toBe("no_file");
    expect(standingState({ ...doc, renew_months: null }, "2030-01-01")).toBe("ok");
    expect(
      standingNeedingAttention([doc, { ...doc, id: "d2", storage_path: null }, { ...doc, id: "d3", is_active: false, storage_path: null }], "2026-11-01").map((d) => d.id)
    ).toEqual(["d2"]);
  });

  it("checks what legal types", () => {
    expect(cleanStandingDocument({ label: " NPO certificate ", renew_months: "" })).toEqual({
      data: {
        label: "NPO certificate",
        description: null,
        certified_on: null,
        renew_months: null,
        expires_on: null,
        for_students: false,
        sort_order: 0,
        is_active: true,
      },
    });
    expect(cleanStandingDocument({ label: "" })).toEqual({ error: "Give the document a name (up to 200 characters)" });
    expect(cleanStandingDocument({ label: "X", renew_months: 3 })).toEqual({
      error: "Give the date it was certified, so the Hub knows when to re-certify",
    });
    expect(cleanStandingDocument({ label: "X", expires_on: "2026-02-30" })).toEqual({ error: "The expiry date must be a date" });
    expect(cleanStandingDocument({ label: "X", for_students: "yes" })).toEqual({
      error: "for_students and is_active must be true or false",
    });
  });
});
