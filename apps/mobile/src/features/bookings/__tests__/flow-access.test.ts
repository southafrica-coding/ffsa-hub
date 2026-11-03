import { makeMe } from "../../../../test/fixtures";
import { bookingsAccess } from "../access";
import { back, chooseKind, next, progress, stepError, STEPS, type FlowState } from "../flow";
import { EMPTY_SPACE, EMPTY_VEHICLE } from "../logic";

import { person } from "../__fixtures__/fixtures";

const perm = (key: string) => ({ key, scopeType: null, scopeId: null, source: "role" });

describe("bookingsAccess (UX gates mirroring the web)", () => {
  it("self_service floor: view spaces, view + request vehicles", () => {
    const a = bookingsAccess(makeMe({ permissions: [perm("bookings.view"), perm("vehicles.view"), perm("vehicles.request")] }));
    expect(a.spaces).toEqual({ view: true, request: false, approve: false, manage: false });
    expect(a.vehicles).toEqual({ view: true, request: true, approve: false, manage: false });
    expect(a.equipment.view).toBe(false);
    expect(a.any).toBe(true);
    expect(a.approver).toBe(false);
  });

  it("booking manager approves spaces; vehicles.manage approves vehicles", () => {
    const a = bookingsAccess(makeMe({ permissions: [perm("bookings.approve"), perm("vehicles.manage")] }));
    expect(a.spaces).toMatchObject({ request: true, approve: true, manage: true });
    expect(a.vehicles).toMatchObject({ request: true, approve: true, manage: true });
    expect(a.approver).toBe(true);
  });

  it("bookings.manage can cancel but not approve (as on the web)", () => {
    const a = bookingsAccess(makeMe({ permissions: [perm("bookings.manage")] }));
    expect(a.spaces).toMatchObject({ request: true, approve: false, manage: true });
  });

  it("admins pass everything", () => {
    const a = bookingsAccess(makeMe({ roles: [{ name: "admin", scopeType: null, scopeId: null }], permissions: [] }));
    expect(a.spaces.approve && a.vehicles.approve && a.equipment.view).toBe(true);
  });

  it("nothing while /api/me hasn't loaded, or with no booking permissions", () => {
    expect(bookingsAccess(null).any).toBe(false);
    expect(bookingsAccess(makeMe({ permissions: [perm("events.view")] })).any).toBe(false);
  });
});

describe("the new-request step machine", () => {
  const start: FlowState = { kind: null, step: "type", space: EMPTY_SPACE, vehicle: EMPTY_VEHICLE };
  const ctx = { unavailableVehicleIds: [], people: [person()], today: "2026-11-03" };

  it("each kind has its steps", () => {
    expect(STEPS.space).toEqual(["type", "space", "when", "details", "review"]);
    expect(STEPS.vehicle).toEqual(["type", "when", "vehicle", "drivers", "details", "review"]);
  });

  it("can't leave the first step without a kind", () => {
    expect(next(start, ctx)).toEqual({ state: start, error: "Choose what you want to book." });
  });

  it("walks a space request through, refusing each step until it's right", () => {
    let s = chooseKind(start, "space");
    s = next(s, ctx).state;
    expect(s.step).toBe("space");
    expect(progress(s)).toEqual({ index: 2, total: 5 });
    expect(next(s, ctx).error).toBe("Please choose a venue.");
    s = next({ ...s, space: { ...s.space, venueId: "v1" } }, ctx).state;
    expect(s.step).toBe("when");
    expect(next(s, ctx).error).toBe("Please choose a date.");
    expect(next({ ...s, space: { ...s.space, date: "2026-11-10", startTime: "20:00", endTime: "19:00" } }, ctx).error).toBe(
      "The end time must be after the start time.",
    );
    s = next({ ...s, space: { ...s.space, date: "2026-11-10" } }, ctx).state;
    expect(s.step).toBe("details");
    expect(stepError(s, ctx)).toBe("Please enter an event name.");
    s = next({ ...s, space: { ...s.space, title: "Youth night" } }, ctx).state;
    expect(s.step).toBe("review");
    // Next on the last step stays put.
    expect(next(s, ctx).state.step).toBe("review");
  });

  it("walks a vehicle request through", () => {
    let s = next(chooseKind(start, "vehicle"), ctx).state;
    expect(s.step).toBe("when");
    s = next({ ...s, vehicle: { ...s.vehicle, checkout: "2026-11-10", returnDate: "2026-11-12", vehicleIds: ["v1"] } }, ctx).state;
    expect(s.step).toBe("vehicle");
    expect(next(s, { ...ctx, unavailableVehicleIds: ["v1"] }).error).toMatch(/unavailable/);
    s = next(s, ctx).state;
    expect(s.step).toBe("drivers");
    expect(next(s, ctx).error).toBe("Add at least one driver.");
    s = next({ ...s, vehicle: { ...s.vehicle, drivers: [{ userId: "p1", name: "Sam Driver", phone: "", hasSaLicense: true, isFirstTime: false }] } }, ctx).state;
    expect(s.step).toBe("details");
    expect(progress(s)).toEqual({ index: 5, total: 6 });
  });

  it("back goes one step, and closes from the first", () => {
    const s: FlowState = { ...start, kind: "space", step: "when" };
    expect(back(s)?.step).toBe("space");
    expect(back({ ...s, step: "type" })).toBeNull();
  });
});
