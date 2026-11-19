import { describe, expect, it } from "vitest";
import { countryIsoFor, isSouthAfrican } from "./country";

describe("countryIsoFor", () => {
  it("reads the stored country name", () => {
    expect(countryIsoFor("United States")).toBe("US");
    expect(countryIsoFor("  zambia ")).toBe("ZM");
  });

  it("accepts a demonym, but not an ambiguous one", () => {
    expect(countryIsoFor("American")).toBe("US");
    expect(countryIsoFor("Congolese")).toBeNull();
    expect(countryIsoFor("Congo (DRC)")).toBe("CD");
  });

  it("returns null when unknown", () => {
    expect(countryIsoFor("")).toBeNull();
    expect(countryIsoFor(null)).toBeNull();
    expect(countryIsoFor("Atlantis")).toBeNull();
  });

  it("knows South Africans need no visa case", () => {
    expect(isSouthAfrican("South Africa")).toBe(true);
    expect(isSouthAfrican("South African")).toBe(true);
    expect(isSouthAfrican("Namibia")).toBe(false);
  });
});
