import { describe, expect, it } from "vitest";
import { whatsAppDigits, whatsAppHref } from "@/components/missio/follow-up/whatsapp";
import { e164FromWaId, formatE164, whatsAppE164 } from "./phone";

describe("whatsAppE164", () => {
  it("turns every South African way of writing a mobile into E.164", () => {
    for (const typed of ["082 360 7000", "0823607000", "082-360-7000", "(082) 360 7000", "+27 82 360 7000", "+27823607000", "27823607000", "0027823607000", "00 27 82 360 7000", "82 360 7000"]) {
      expect(whatsAppE164(typed), typed).toBe("+27823607000");
    }
  });

  it("fixes the 27 + 0 mistake from old exports", () => {
    expect(whatsAppE164("270823607000")).toBe("+27823607000");
    expect(whatsAppE164("+27 (0)82 360 7000")).toBe("+27823607000");
  });

  it("keeps other countries in international form", () => {
    expect(whatsAppE164("+44 7700 900123")).toBe("+447700900123");
    expect(whatsAppE164("0044 7700 900123")).toBe("+447700900123");
    expect(whatsAppE164("+1 616 218 7556")).toBe("+16162187556");
  });

  it("refuses junk, short and wrong-length numbers", () => {
    for (const bad of [null, undefined, "", "   ", "call me", "082 360 700", "08236070001", "0", "+27 82 360 70", "+27 82 360 70001", "12345", "+0 82 360 7000", "082 360 7000 ext 4", "+1234567890123456"]) {
      expect(whatsAppE164(bad as string | null), String(bad)).toBeNull();
    }
  });

  it("reads a webhook wa_id (digits, no plus)", () => {
    expect(e164FromWaId("27823607000")).toBe("+27823607000");
    expect(e164FromWaId("447700900123")).toBe("+447700900123");
    expect(e164FromWaId("+27823607000")).toBeNull();
    expect(e164FromWaId("abc")).toBeNull();
    expect(e164FromWaId("2782")).toBeNull();
  });

  it("matches the number a pastor typed against the wa_id WhatsApp sends", () => {
    expect(e164FromWaId("27823607000")).toBe(whatsAppE164("082 360 7000"));
  });

  it("formats South African numbers for reading", () => {
    expect(formatE164("+27823607000")).toBe("+27 82 360 7000");
    expect(formatE164("+447700900123")).toBe("+447700900123");
  });

  it("leaves the follow-up wa.me helpers as they were", () => {
    expect(whatsAppDigits("0821234567")).toBe("27821234567");
    expect(whatsAppHref("082 123 4567")).toBe("https://wa.me/27821234567");
  });
});
