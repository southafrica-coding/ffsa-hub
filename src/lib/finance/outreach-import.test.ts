import { describe, expect, it } from "vitest";
import { rowKey, type ImportRow } from "./outreach-import";

const base: ImportRow = {
  category_id: "cat-1",
  expense_date: "2026-08-01",
  zar_amount: 150.5,
  receipt_code: "R-001",
  vendor: "Shoprite",
  description: "Team groceries",
};

const TEAM = "team-a";

describe("rowKey", () => {
  it("gives the same key to the same row twice — the whole point", () => {
    expect(rowKey(TEAM, base)).toBe(rowKey(TEAM, { ...base }));
  });

  it("ignores casing and stray whitespace from the sheet", () => {
    const messy = {
      ...base,
      vendor: "  SHOPRITE ",
      description: "Team   groceries",
    };
    expect(rowKey(TEAM, messy)).toBe(rowKey(TEAM, base));
  });

  it("treats 150.5 and 150.50 as one amount", () => {
    expect(rowKey(TEAM, { ...base, zar_amount: 150.5 })).toBe(
      rowKey(TEAM, { ...base, zar_amount: 150.50 })
    );
  });

  it("separates rows that differ by amount — a corrected figure is new", () => {
    expect(rowKey(TEAM, { ...base, zar_amount: 151 })).not.toBe(rowKey(TEAM, base));
  });

  it("separates rows that differ by date", () => {
    expect(rowKey(TEAM, { ...base, expense_date: "2026-08-02" })).not.toBe(
      rowKey(TEAM, base)
    );
  });

  it("never collides across teams, so one team's sheet cannot mask another's", () => {
    expect(rowKey("team-b", base)).not.toBe(rowKey(TEAM, base));
  });

  it("distinguishes a null vendor from an empty string without throwing", () => {
    expect(() => rowKey(TEAM, { ...base, vendor: null })).not.toThrow();
    expect(rowKey(TEAM, { ...base, vendor: null })).toBe(
      rowKey(TEAM, { ...base, vendor: "" })
    );
  });

  it("keeps field boundaries — content cannot slide between columns", () => {
    // Without a delimiter, vendor "ab" + desc "c" would hash like "a" + "bc".
    const a = { ...base, vendor: "ab", description: "c" };
    const b = { ...base, vendor: "a", description: "bc" };
    expect(rowKey(TEAM, a)).not.toBe(rowKey(TEAM, b));
  });
});
