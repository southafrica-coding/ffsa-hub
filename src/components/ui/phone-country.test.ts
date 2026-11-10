import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/lib/profile/options";
import { matchDial } from "./phone-country";

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
