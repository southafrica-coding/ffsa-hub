import {
  approvalNote,
  canCancel,
  dateRangeLabel,
  dayCount,
  driverEligibility,
  driverFromPerson,
  driversError,
  EMPTY_SPACE,
  EMPTY_VEHICLE,
  emptyInspection,
  groupBookings,
  hm,
  humanDate,
  inspectionError,
  inspectionPayload,
  licenceStatus,
  spaceDetailsError,
  spaceItem,
  spacePayload,
  spaceWhenError,
  statusInfo,
  timeRangeError,
  timeRangeLabel,
  toIso2,
  todayISO,
  vehicleChoiceError,
  vehicleDetailsError,
  vehicleDryRunPayload,
  vehicleItem,
  vehicleNames,
  vehiclePayload,
  vehicleWhenError,
  type BookingItem,
  type VehicleForm,
} from "../logic";

import { person, spaceBooking, vehicleBooking } from "../__fixtures__/fixtures";

const TODAY = "2026-11-03";

describe("dates", () => {
  it("formats like the web", () => {
    expect(humanDate("2026-11-03")).toBe("Tue 3 Nov 2026");
    expect(dateRangeLabel("2026-11-03", null)).toBe("3 Nov 2026");
    expect(dateRangeLabel("2026-11-03", "2026-11-03")).toBe("3 Nov 2026");
    expect(dateRangeLabel("2026-11-03", "2026-11-05")).toBe("3 Nov 2026 – 5 Nov 2026");
    expect(timeRangeLabel("09:00:00", "10:30:00")).toBe("09:00 – 10:30");
    expect(timeRangeLabel("9:00", null)).toBe("09:00");
    expect(timeRangeLabel(null, null)).toBe("All day");
    expect(hm("bad")).toBeNull();
  });

  it("counts days inclusively and never below one", () => {
    expect(dayCount("2026-11-03", "2026-11-03")).toBe(1);
    expect(dayCount("2026-11-03", "2026-11-05")).toBe(3);
    expect(dayCount("2026-11-05", "2026-11-03")).toBe(1);
  });

  it("today is the phone's local date", () => {
    expect(todayISO(new Date(2026, 0, 9, 23, 30))).toBe("2026-01-09");
  });
});

describe("status words and icons (never colour alone)", () => {
  it("every status has a label and an icon", () => {
    for (const s of ["pending", "approved", "denied", "cancelled", "completed"] as const) {
      const info = statusInfo(s);
      expect(info.label.length).toBeGreaterThan(3);
      expect(info.icon).toBeTruthy();
    }
    expect(statusInfo("pending").label).toBe("Waiting for approval");
    expect(statusInfo("denied").label).toBe("Declined");
  });
});

describe("groupBookings", () => {
  const item = (over: Partial<BookingItem>): BookingItem => ({
    kind: "space",
    id: "x",
    title: "T",
    place: "Hall",
    status: "approved",
    start: TODAY,
    end: TODAY,
    when: "All day",
    repeats: false,
    ...over,
  });

  it("splits waiting, upcoming and past", () => {
    const g = groupBookings(
      [
        item({ id: "w", status: "pending", start: "2026-11-10", end: "2026-11-10" }),
        item({ id: "u2", status: "approved", start: "2026-11-20", end: "2026-11-20" }),
        item({ id: "u1", status: "approved", start: TODAY, end: TODAY }),
        item({ id: "p-old", status: "approved", start: "2026-10-01", end: "2026-10-01" }),
        item({ id: "p-pending-over", status: "pending", start: "2026-10-05", end: "2026-10-05" }),
        item({ id: "p-cancel", status: "cancelled", start: "2026-12-01", end: "2026-12-01" }),
        item({ id: "p-denied", status: "denied", start: "2026-12-02", end: "2026-12-02" }),
        item({ id: "p-done", kind: "vehicle", status: "completed", start: "2026-11-01", end: "2026-11-04" }),
      ],
      TODAY,
    );
    expect(g.waiting.map((i) => i.id)).toEqual(["w"]);
    expect(g.upcoming.map((i) => i.id)).toEqual(["u1", "u2"]);
    // Most recent first.
    expect(g.past.map((i) => i.id)).toEqual(["p-denied", "p-cancel", "p-done", "p-pending-over", "p-old"]);
  });

  it("a multi-day booking still running today is upcoming", () => {
    const g = groupBookings([item({ id: "m", start: "2026-11-01", end: "2026-11-04" })], TODAY);
    expect(g.upcoming).toHaveLength(1);
  });
});

describe("items from rows", () => {
  it("space rows", () => {
    const i = spaceItem(spaceBooking({ series_id: "s1", start_time: "18:00:00", end_time: "21:00:00" }));
    expect(i).toMatchObject({ kind: "space", place: "Main hall", when: "18:00 – 21:00", repeats: true });
  });

  it("vehicle rows name the vehicles, or say none is assigned", () => {
    expect(vehicleNames(vehicleBooking())).toBe("Vehicle not assigned yet");
    const b = vehicleBooking({ assignments: [{ vehicle: { id: "v1", name: "Quantum", registration_plate: "CA 1" } }] });
    expect(vehicleItem(b)).toMatchObject({ place: "Quantum", when: "3 days" });
  });
});

describe("canCancel (the web's rule)", () => {
  it("only live bookings, by the requester or a manager", () => {
    expect(canCancel("pending", true, false)).toBe(true);
    expect(canCancel("approved", false, true)).toBe(true);
    expect(canCancel("approved", false, false)).toBe(false);
    expect(canCancel("cancelled", true, true)).toBe(false);
    expect(canCancel("completed", true, true)).toBe(false);
  });
});

describe("space request validation", () => {
  const f = { ...EMPTY_SPACE, venueId: "v1", date: "2026-11-10", title: "Youth night" };

  it("needs a date, an end date not before it", () => {
    expect(spaceWhenError({ ...f, date: "" })).toBe("Please choose a date.");
    expect(spaceWhenError({ ...f, endDate: "2026-11-09" })).toBe("The end date must be on or after the start date.");
    expect(spaceWhenError(f)).toBeNull();
  });

  it("time range: end after start, set-up before, set-down after", () => {
    expect(timeRangeError({ ...f, startTime: "18:00", endTime: "18:00" })).toBe("The end time must be after the start time.");
    expect(timeRangeError({ ...f, startTime: "18:00", endTime: "17:00" })).toBe("The end time must be after the start time.");
    expect(timeRangeError({ ...f, startTime: "18:00", setupTime: "18:30" })).toBe("Set-up must start at or before the event starts.");
    expect(timeRangeError({ ...f, endTime: "21:00", setdownTime: "20:00" })).toBe("Set-down must finish at or after the event ends.");
    expect(timeRangeError({ ...f, setupTime: "17:00", startTime: "18:00", endTime: "21:00", setdownTime: "22:00" })).toBeNull();
    // Only one side, or none: fine (a whole-day booking).
    expect(timeRangeError({ ...f, startTime: "18:00" })).toBeNull();
    expect(timeRangeError(f)).toBeNull();
    // Multi-day bookings take the whole day, so their times aren't compared.
    expect(timeRangeError({ ...f, endDate: "2026-11-12", startTime: "18:00", endTime: "09:00" })).toBeNull();
  });

  it("needs an event name", () => {
    expect(spaceDetailsError({ ...f, title: "  " })).toBe("Please enter an event name.");
    expect(spaceDetailsError(f)).toBeNull();
  });

  it("builds the web form's body; a dry run gets a placeholder title", () => {
    expect(spacePayload({ ...f, startTime: "18:00", ministryId: "" }, false)).toEqual({
      dryRun: false,
      venue_id: "v1",
      ministry_id: null,
      title: "Youth night",
      description: null,
      point_person: null,
      requester_name: null,
      start_time: "18:00",
      end_time: null,
      setup_time: null,
      setdown_time: null,
      recurrence: "none",
      booking_date: "2026-11-10",
      end_date: null,
    });
    expect(spacePayload({ ...f, title: "" }, true).title).toBe("Availability check");
  });

  it("says what happens to the request (web wording)", () => {
    expect(approvalNote(true, true)).toMatch(/confirms straight away because you're a booking manager/);
    expect(approvalNote(false, false)).toMatch(/Instant confirmation/);
    expect(approvalNote(true, false)).toBe("Goes to the booking manager for approval.");
  });
});

describe("driver eligibility (hint; the API re-checks)", () => {
  it("licence and passport rules at request; driving test only at approval", () => {
    expect(driverEligibility(person({ licence_file_url: null }), null, "request", TODAY)).toMatchObject({ ok: false, reason: "no_licence" });
    expect(driverEligibility(person({ passport_file_url: null }), null, "request", TODAY)).toMatchObject({ ok: false, reason: "no_passport" });
    expect(driverEligibility(person({ licence_expiry_date: "2026-11-01" }), null, "request", TODAY)).toMatchObject({ ok: false, reason: "expired" });
    expect(driverEligibility(person({ licence_expiry_date: "2026-11-05" }), "2026-11-06", "request", TODAY)).toMatchObject({
      ok: false,
      reason: "expires_before_return",
    });
    const tester = person({ base_driving_test_status: "pending" });
    expect(driverEligibility(tester, null, "request", TODAY)).toEqual({ ok: true });
    expect(driverEligibility(tester, null, "approval", TODAY)).toMatchObject({ ok: false, reason: "test_pending" });
    expect(driverEligibility(person({ base_driving_test_status: "failed" }), null, "approval", TODAY)).toMatchObject({ reason: "test_failed" });
  });

  it("status line tones", () => {
    expect(licenceStatus(person(), null, TODAY)).toEqual({ label: "Licence valid to 2028-01-01", tone: "ok" });
    expect(licenceStatus(person({ base_driving_test_status: "pending" }), null, TODAY).tone).toBe("warn");
    expect(licenceStatus(person({ licence_file_url: null }), null, TODAY).tone).toBe("bad");
  });

  it("fills a driver row the web's way", () => {
    expect(driverFromPerson(person({ country: "South Africa", phone: "+2782", base_driving_test_status: "pending" }))).toEqual({
      userId: "p1",
      name: "Sam Driver",
      phone: "+2782",
      hasSaLicense: true,
      isFirstTime: true,
    });
    expect(toIso2("za")).toBe("ZA");
    expect(toIso2("Kenya")).toBe("");
    expect(toIso2(null)).toBe("");
  });
});

describe("vehicle request validation and body", () => {
  const f: VehicleForm = {
    ...EMPTY_VEHICLE,
    checkout: "2026-11-10",
    returnDate: "2026-11-12",
    bookingName: "Youth team",
    pointPerson: "Jo",
    destination: "Airport",
    drivers: [{ userId: "p1", name: "Sam Driver", phone: "", hasSaLicense: true, isFirstTime: false }],
  };

  it("dates", () => {
    expect(vehicleWhenError({ ...f, checkout: "" })).toBe("Please choose collection and return dates.");
    expect(vehicleWhenError({ ...f, returnDate: "2026-11-09" })).toBe("The return date must be on or after the collection date.");
    expect(vehicleWhenError(f)).toBeNull();
  });

  it("refuses a vehicle the server said is taken", () => {
    expect(vehicleChoiceError({ ...f, vehicleIds: ["v1"] }, ["v1"])).toBe("One or more chosen vehicles is unavailable for those dates.");
    expect(vehicleChoiceError({ ...f, vehicleIds: ["v2"] }, ["v1"])).toBeNull();
  });

  it("drivers: at least one, each licensed for the whole trip", () => {
    expect(driversError({ ...f, drivers: [] }, [], TODAY)).toBe("Add at least one driver.");
    expect(driversError(f, [person({ licence_expiry_date: "2026-11-11" })], TODAY)).toBe(
      "Sam Driver cannot be added as a driver: Licence expires on 2026-11-11, before the return date.",
    );
    expect(driversError(f, [person()], TODAY)).toBeNull();
  });

  it("details (web order and wording)", () => {
    expect(vehicleDetailsError({ ...f, bookingName: "" })).toBe("Please enter a booking name (team or person).");
    expect(vehicleDetailsError({ ...f, pointPerson: "" })).toBe("Please enter the point person for this booking.");
    expect(vehicleDetailsError({ ...f, destination: "" })).toBe("Please say where you plan to go with the vehicle.");
    expect(vehicleDetailsError({ ...f, purpose: "other" })).toBe("Please describe the purpose.");
    expect(vehicleDetailsError({ ...f, homeCountry: "ZAF" })).toMatch(/two-letter code/);
    expect(vehicleDetailsError(f)).toBeNull();
  });

  it("the body the API takes", () => {
    const body = vehiclePayload({ ...f, numPeople: "5", homeCountry: "za", purpose: "other", purposeNote: " Camp " });
    expect(body).toMatchObject({
      booking_name: "Youth team",
      purpose: "other",
      purpose_note: "Camp",
      num_people: 5,
      home_country: "ZA",
      checkout_date: "2026-11-10",
      return_date: "2026-11-12",
      vehicle_ids: [],
      drivers: [{ user_id: "p1", name: "Sam Driver", phone: "", has_sa_license: true, is_first_time: false }],
    });
    expect(vehiclePayload(f).purpose_note).toBeNull();
    expect(vehiclePayload(f).num_people).toBeNull();
  });

  it("a dry run carries placeholders the route checks before it answers", () => {
    expect(vehicleDryRunPayload("2026-11-10", "2026-11-12")).toEqual({
      dryRun: true,
      booking_name: "Availability check",
      destination: "Availability check",
      point_person: "Availability check",
      checkout_date: "2026-11-10",
      return_date: "2026-11-12",
      vehicle_ids: [],
    });
  });
});

describe("collection / return check", () => {
  const base = emptyInspection({ vehicleId: "v1", driverNames: "Sam", usagePurpose: "Ministry", checkinDate: "2026-11-12" });
  const filled = { ...base, mileage: "12345", allDriversPresent: true, saLicenseConfirmed: true, agreed: true };

  it("starts with the inventory ticked, nothing answered", () => {
    expect(Object.values(base.inventory).every(Boolean)).toBe(true);
    expect(base.allDriversPresent).toBeNull();
  });

  it("collection checks, in the web's order", () => {
    expect(inspectionError("collection", base, {})).toBe("Please enter the vehicle mileage.");
    expect(inspectionError("collection", { ...filled, mileage: "12.5" }, {})).toMatch(/whole number/);
    expect(inspectionError("collection", { ...filled, allDriversPresent: null }, {})).toBe("Please confirm whether every driver is present.");
    expect(inspectionError("collection", { ...filled, usagePurpose: "" }, {})).toBe("Please say what the vehicle is being used for.");
    expect(inspectionError("collection", { ...filled, saLicenseConfirmed: null }, {})).toMatch(/valid SA licence/);
    expect(inspectionError("collection", { ...filled, agreed: false }, {})).toBe("Please confirm the declaration before submitting.");
    expect(inspectionError("collection", filled, {})).toBeNull();
  });

  it("return: evidence is asked for only when the claim is made", () => {
    const ret = { ...filled, communicatedTruthfully: true, inspectionPermission: true };
    expect(inspectionError("return", { ...ret, checkinDate: "" }, {})).toBe("Please enter the check-in date.");
    expect(inspectionError("return", { ...ret, washed: true }, {})).toBe("Please attach the carwash receipt, or untick 'washed'.");
    expect(inspectionError("return", { ...ret, washed: true }, { carwash_receipt: 1 })).toBeNull();
    expect(inspectionError("return", { ...ret, fuelFull: true }, {})).toBe("Please attach a photo of the fuel gauge, or untick 'refuelled'.");
    expect(inspectionError("return", { ...ret, inspectionPermission: false }, {})).toBe("Please agree to both return declarations before submitting.");
    expect(inspectionError("return", ret, {})).toBeNull();
  });

  it("sends exactly the web's body", () => {
    const c = inspectionPayload("b1", "collection", { ...filled, damagePanels: ["roof"], notes: " scratch " });
    expect(c).toMatchObject({
      vehicle_booking_id: "b1",
      vehicle_id: "v1",
      kind: "collection",
      mileage: 12345,
      damage_panels: ["roof"],
      washed: null,
      fuel_full: null,
      condition_notes: "scratch",
      usage_purpose: "Ministry",
      sa_license_confirmed: true,
      checkin_date: null,
      communicated_truthfully: null,
    });
    const r = inspectionPayload("b1", "return", { ...filled, washed: true, damagePanels: ["roof"] });
    expect(r).toMatchObject({ kind: "return", damage_panels: [], inventory: {}, washed: true, usage_purpose: null, sa_license_confirmed: null, checkin_date: "2026-11-12" });
  });
});
