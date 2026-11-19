import { describe, expect, it } from "vitest";
import { B2B_KIND, RECORD_KINDS } from "@/lib/fleet/rules";
import { bookingHint, initialVisitForm, visitBody } from "./visit-form";
import { vehicleFormOf, vehiclePatch } from "./vehicle-form";

const TUE = "2026-11-17";

describe("booking hint", () => {
  const trips = [
    { id: "a", from: "2026-11-20", to: "2026-11-22", label: "HULC" },
    { id: "b", from: "2026-11-27", to: "2026-11-28", label: null },
  ];
  it("names clashes, trips soon after, and the first free 48 hours", () => {
    const h = bookingHint(trips, "2026-11-19", "2026-11-20", { from: "2026-11-23", to: "2026-11-24" });
    expect(h.clash).toBe("Clashes with HULC (Fri, 20 Nov – Sun, 22 Nov).");
    expect(h.near).toBe("Heads-up: Trip starts Fri, 27 Nov, soon after this visit.");
    expect(h.gap).toEqual({ from: "2026-11-23", to: "2026-11-24", text: "Mon, 23 Nov – Tue, 24 Nov" });
  });
  it("an empty or earlier Back on means the same day", () => {
    expect(bookingHint(trips, "2026-11-19", "2026-11-01", null).clash).toBeNull();
    expect(bookingHint(trips, "", "", null)).toEqual({ clash: null, near: null, gap: null });
  });
});

describe("visit form", () => {
  it("starts a booking as a bumper-to-bumper inspection today, a done visit as a service", () => {
    expect(initialVisitForm("booked", TUE, [])).toMatchObject({ kind: RECORD_KINDS[0], date: TUE, until: TUE, updateLastService: true });
    expect(initialVisitForm("done", TUE, []).kind).toBe("Service");
  });
  it("an unknown provider becomes Other…", () => {
    const f = initialVisitForm("done", TUE, ["Kia Motors"], { kind: "Service", date: TUE, provider: "Joe's", status: "done" });
    expect(f).toMatchObject({ provider: "__other", providerOther: "Joe's", updateLastService: false });
  });
  it("refuses what the app refuses", () => {
    const f = initialVisitForm("done", TUE, []);
    expect(visitBody("v", { ...f, date: "" }, 1)).toEqual({ error: "Enter the date of the visit." });
    expect(visitBody("v", { ...f, kind: B2B_KIND, odometer: "" }, 1)).toEqual({
      error: "Enter the odometer reading: the next service and bumper-to-bumper inspection are worked out from it.",
    });
    expect(visitBody("v", { ...initialVisitForm("booked", TUE, []), date: "" }, 1)).toEqual({ error: "Enter the day the vehicle goes in." });
  });
  it("builds the route body", () => {
    const f = { ...initialVisitForm("done", TUE, []), odometer: "312 606", cost: "", work: [{ d: " Pads ", cost: "800", chk: "ok" }, { d: "", cost: "", chk: "" }], provider: "__other", providerOther: " Joe " };
    const out = visitBody("v1", f, 4) as { body: Record<string, unknown> };
    expect(out.body).toMatchObject({ vehicleId: "v1", status: "done", odometer: 312606, provider: "Joe", work: [{ d: "Pads", cost: "800", chk: "ok" }], updateLastService: true, mins: 4 });
    const bk = visitBody("v1", { ...initialVisitForm("booked", TUE, []), until: "2026-11-01" }, 1, { work: [{ d: "kept" }] }) as { body: Record<string, unknown> };
    expect(bk.body).toMatchObject({ until: TUE, odometer: null, work: [{ d: "kept" }], updateLastService: false });
  });
});

describe("vehicle form", () => {
  const v = { id: "v", name: "Honda CR-V", status: "In service", odometer: 312606, lastService: { date: "2026-01-01", km: 300000, provider: "Honda" } };
  const x = { photo: null, transmission: "Automatic", vin: null, engineNo: null, insurer: null, policyNo: null, tracker: null, base: null, notes: null, inspectionDay: null, lastInspection: null };
  it("never renames the vehicle: the Hub's name is the only name", () => {
    const f = vehicleFormOf(v, x);
    expect("name" in f).toBe(false);
    expect("name" in (vehiclePatch(f, f, TUE) as { patch: Record<string, unknown> }).patch).toBe(false);
  });
  it("sets statusSince only when the status changes, and logs the odometer only when it changes", () => {
    const f = { ...vehicleFormOf(v, x), lastServiceProvider: "Honda" };
    const same = vehiclePatch(f, f, TUE) as { patch: Record<string, unknown>; odometer: number | null };
    expect(same.patch.statusSince).toBeUndefined();
    expect(same.odometer).toBeNull();
    expect(same.patch.lastService).toEqual({ date: "2026-01-01", km: 300000, provider: "Honda" });
    expect(same.patch.licenceExpiry).toBeNull();
    const changed = vehiclePatch(f, { ...f, status: "In workshop", odometer: "313 000", year: "2014" }, TUE) as { patch: Record<string, unknown>; odometer: number | null };
    expect(changed.patch).toMatchObject({ status: "In workshop", statusSince: TUE, year: 2014 });
    expect(changed.odometer).toBe(313000);
  });
});
