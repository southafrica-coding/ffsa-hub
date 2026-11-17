import { describe, expect, it } from "vitest";
import { maskEmail, maskName, maskPhone } from "./mask";

describe("maskName", () => {
  it("keeps the first letter of each name part", () => {
    expect(maskName("Jane", "Mail")).toBe("J*** M***");
    expect(maskName("mary ann", "smith")).toBe("M*** A*** S***");
    expect(maskName("Madonna", "")).toBe("M***");
    expect(maskName(null, null)).toBe("***");
  });
});

describe("maskEmail", () => {
  it("keeps the first character of the local part and the domain, and the rest of the domain", () => {
    expect(maskEmail("jane@gmail.com")).toBe("j***@g***.com");
    expect(maskEmail("  Jane@Gmail.com ")).toBe("j***@g***.com");
    expect(maskEmail("jane@mail.co.uk")).toBe("j***@m***.co.uk");
  });

  it("returns null instead of a value it cannot mask", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("")).toBeNull();
    expect(maskEmail("not-an-email")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("shows only the last four digits", () => {
    expect(maskPhone("+27821234567")).toBe("*** *** 4567");
    expect(maskPhone("082 123 4567")).toBe("*** *** 4567");
  });

  it("returns null when there are not four digits to show", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("12")).toBeNull();
  });
});
