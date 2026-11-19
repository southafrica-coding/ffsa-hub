import { describe, expect, it } from "vitest";
import {
  ScanReadingSchema,
  isRealDate,
  markConfirmed,
  readingPrompt,
  suggestMatch,
  toStoredReading,
  type ScanReading,
} from "./reading";

const reading = (over: Partial<ScanReading> = {}): ScanReading => ({
  is_legible: true,
  document_kind: "South African passport",
  type_key: "passport",
  summary: "A passport.",
  things_to_watch: [],
  title: { value: "Passport", sure: true },
  holder: { value: "Sample Person", sure: true },
  issuer: { value: "Home Affairs", sure: true },
  reference_no: { value: "A01234567", sure: false },
  issued_on: { value: "2019-03-01", sure: true },
  expires_on: { value: "2029-02-28", sure: true },
  text: "REPUBLIC OF SOUTH AFRICA …",
  ...over,
});

describe("ScanReadingSchema", () => {
  it("accepts a full reading and refuses a missing field", () => {
    expect(ScanReadingSchema.safeParse(reading()).success).toBe(true);
    const { expires_on: _drop, ...rest } = reading(); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(ScanReadingSchema.safeParse(rest).success).toBe(false);
  });
});

describe("isRealDate", () => {
  it("only real calendar dates", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2027-02-29")).toBe(false);
    expect(isRealDate("2027-13-01")).toBe(false);
    expect(isRealDate("01/02/2027")).toBe(false);
  });
});

describe("toStoredReading", () => {
  it("keeps every value unconfirmed", () => {
    const s = toStoredReading(reading(), ["passport"]);
    expect(Object.values(s.fields ?? {}).every((f) => f.confirmed === false)).toBe(true);
    expect(s.fields?.reference_no).toEqual({ value: "A01234567", sure: false, confirmed: false });
    expect(s.fields?.type_key?.value).toBe("passport");
  });
  it("drops empty values, impossible dates and unknown types", () => {
    const s = toStoredReading(
      reading({
        holder: { value: "  ", sure: true },
        issuer: { value: null, sure: false },
        expires_on: { value: "2029-02-30", sure: true },
        type_key: "made_up",
      }),
      ["passport"]
    );
    expect(s.fields?.holder).toBeUndefined();
    expect(s.fields?.issuer).toBeUndefined();
    expect(s.fields?.expires_on).toBeUndefined();
    expect(s.fields?.type_key).toBeUndefined();
    expect(toStoredReading(reading({ type_key: "none" }), ["passport"]).fields?.type_key).toBeUndefined();
  });
});

describe("markConfirmed", () => {
  it("confirms only what was ticked", () => {
    const s = markConfirmed(toStoredReading(reading(), ["passport"]), ["expires_on", "nope"]);
    expect(s.fields?.expires_on?.confirmed).toBe(true);
    expect(s.fields?.issued_on?.confirmed).toBe(false);
  });
});

describe("readingPrompt", () => {
  it("names the types and today, and asks for suggestions only", () => {
    const p = readingPrompt({
      today: "2026-11-18",
      folderName: "Personal papers",
      folderKind: "personal",
      types: [{ key: "passport", name: "Passport", category: "personal" }],
    });
    expect(p).toContain("2026-11-18");
    expect(p).toContain("- passport: Passport (personal)");
    expect(p).toContain("a person checks every value");
  });
});

describe("suggestMatch", () => {
  const F = "folder-1";
  const types = new Map([["passport", "t-pass"]]);
  const doc = (id: string, over: Record<string, unknown> = {}) => ({
    id, folder_id: F, title: "Something", type_id: null, reference_no: null, expires_on: null, status: "held", ...over,
  });

  it("same reference number wins, ignoring spaces and case", () => {
    const s = toStoredReading(reading({ reference_no: { value: "a0 1234-567", sure: true } }), ["passport"]);
    expect(suggestMatch(s, F, [doc("d1", { reference_no: "A01234567" })], types)).toEqual({ documentId: "d1", why: "Same reference number" });
  });
  it("never matches across folders", () => {
    const s = toStoredReading(reading(), ["passport"]);
    expect(suggestMatch(s, F, [doc("d1", { folder_id: "other", reference_no: "A01234567" })], types)).toBeNull();
  });
  it("same type when there is exactly one live one", () => {
    const s = toStoredReading(reading({ reference_no: { value: null, sure: false } }), ["passport"]);
    expect(suggestMatch(s, F, [doc("d1", { type_id: "t-pass", expires_on: "2029-02-28" })], types)?.documentId).toBe("d1");
    expect(suggestMatch(s, F, [doc("d1", { type_id: "t-pass" }), doc("d2", { type_id: "t-pass" })], types)).toBeNull();
  });
  it("a later expiry than the one on file suggests a new document (a renewal)", () => {
    const s = toStoredReading(reading({ reference_no: { value: null, sure: false } }), ["passport"]);
    expect(suggestMatch(s, F, [doc("d1", { type_id: "t-pass", expires_on: "2020-01-01" })], types)).toBeNull();
  });
  it("falls back to the same title, then to nothing", () => {
    const s = toStoredReading(reading({ reference_no: { value: null, sure: false }, type_key: "none" }), ["passport"]);
    expect(suggestMatch(s, F, [doc("d1", { title: "passport" })], types)?.why).toBe("Same title");
    expect(suggestMatch(s, F, [doc("d1", { title: "Lease" })], types)).toBeNull();
  });
});
