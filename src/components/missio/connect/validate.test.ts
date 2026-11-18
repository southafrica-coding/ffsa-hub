import { describe, expect, it } from "vitest";
import { toConnectBody, validateConnect } from "./validate";
import type { ConnectDraft } from "./types";

function draft(overrides: Partial<ConnectDraft> = {}): ConnectDraft {
  return {
    name: "Lerato Mokoena",
    phone: "082 555 0142",
    visitType: "first_time",
    wantsHouseChurch: true,
    wantsPrayer: false,
    prayerRequest: "",
    notes: "",
    ...overrides,
  };
}

describe("connect card validation", () => {
  it("accepts a short card and always sends an empty honeypot", () => {
    expect(validateConnect(draft())).toEqual({});
    expect(toConnectBody(draft({ notes: "  " }))).toEqual({
      name: "Lerato Mokoena",
      phone: "082 555 0142",
      visitType: "first_time",
      wantsHouseChurch: true,
      wantsPrayer: false,
      website: "",
    });
  });

  it("keeps optional notes and a prayer request when they are filled in", () => {
    const body = toConnectBody(
      draft({
        wantsPrayer: true,
        prayerRequest: " My mother is unwell. ",
        notes: " Sat on the left. ",
      })
    );
    expect(body).not.toHaveProperty("email");
    expect(body.prayerRequest).toBe("My mother is unwell.");
    expect(body.notes).toBe("Sat on the left.");
    expect(body.website).toBe("");
  });

  it("reports each missing or oversized field", () => {
    const errors = validateConnect(
      draft({
        name: " A ",
        phone: "12",
        visitType: "",
        notes: "x".repeat(1001),
        wantsPrayer: true,
        prayerRequest: "y".repeat(1001),
      })
    );
    expect(errors.name).toMatch(/name/);
    expect(errors.phone).toMatch(/phone/);
    expect(errors.visitType).toBe("Choose one.");
    expect(errors.notes).toMatch(/1,000/);
    expect(errors.prayerRequest).toMatch(/1,000/);
  });

  it("asks for a name when the field is blank", () => {
    expect(validateConnect(draft({ name: "  " })).name).toBe("Enter your name.");
    expect(validateConnect(draft({ phone: "   " })).phone).toBe("Enter a phone number.");
  });
});
