import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/lib/profile/options";
import { formatStoredPhone, matchDial, phoneEdit } from "./phone-country";

describe("matchDial", () => {
  it("does not treat a short +1 as a country while a longer NANP code is still possible", () => {
    expect(matchDial("1", COUNTRIES)).toBeNull();
    expect(matchDial("12", COUNTRIES)).toBeNull();
    expect(matchDial("124", COUNTRIES)).toBeNull();
  });

  it("selects the Bahamas once +1242 is complete", () => {
    expect(matchDial("1242", COUNTRIES)?.iso).toBe("BS");
    expect(matchDial("1242555", COUNTRIES)?.iso).toBe("BS");
  });

  it("falls back to +1 when the digits cannot be a longer code", () => {
    expect(matchDial("1202", COUNTRIES)?.dial).toBe("+1");
  });

  it("matches a unique dial as soon as it is unambiguous", () => {
    expect(matchDial("27", COUNTRIES)?.iso).toBe("ZA");
    expect(matchDial("44", COUNTRIES)?.iso).toBe("GB");
  });
});

describe("phoneEdit", () => {
  it("clears the stored value while a + prefix is unfinished", () => {
    expect(phoneEdit("+", "+27", COUNTRIES).stored).toBe("");
    expect(phoneEdit("+1", "+27", COUNTRIES).stored).toBe("");
    expect(phoneEdit("+124", "+27", COUNTRIES).stored).toBe("");
    expect(phoneEdit("+999", "+27", COUNTRIES).stored).toBe("");
  });

  it("keeps a leading 0 after the country code", () => {
    expect(formatStoredPhone("+27", "0821234567", "display")).toBe("+27 0821234567");
    expect(formatStoredPhone("+27", "0821234567", "e164")).toBe("+270821234567");
    expect(phoneEdit("+270821234567", "+1", COUNTRIES, "e164").stored).toBe("+270821234567");
  });
});
