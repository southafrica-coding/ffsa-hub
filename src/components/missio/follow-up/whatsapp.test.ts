import { describe, expect, it } from "vitest";
import { telHref, whatsAppDigits, whatsAppHref } from "./whatsapp";

describe("WhatsApp links", () => {
  it("turns a local South African mobile into a wa.me link", () => {
    expect(whatsAppDigits("0821234567")).toBe("27821234567");
    expect(whatsAppHref("082 123 4567")).toBe("https://wa.me/27821234567");
    expect(whatsAppHref("0825550142")).toBe("https://wa.me/27825550142");
  });

  it("keeps numbers that are already in international form", () => {
    expect(whatsAppHref("+27 82 123 4567")).toBe("https://wa.me/27821234567");
    expect(whatsAppHref("27821234567")).toBe("https://wa.me/27821234567");
    expect(whatsAppHref("0027821234567")).toBe("https://wa.me/27821234567");
  });

  it("returns nothing when there is no usable phone", () => {
    expect(whatsAppHref(null)).toBeNull();
    expect(whatsAppHref("")).toBeNull();
    expect(whatsAppHref("call me")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("082 555 0142")).toBe("tel:0825550142");
  });
});
