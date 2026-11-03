import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Alert } from "react-native";

import type { MeState } from "@/features/shell";

import { makeMe } from "../../../../test/fixtures";
import { bookingsFetch } from "../client";
import { loadSpaceBooking, loadVehicleBooking } from "../data";
import { ServerRefusal } from "../http";
import InspectionScreen, { attachedCounts, photoSections } from "../screens/InspectionScreen";
import SpaceDetailScreen from "../screens/SpaceDetailScreen";
import VehicleDetailScreen, { checkState } from "../screens/VehicleDetailScreen";
import { strings } from "../strings";
import { spaceBooking, vehicleBooking } from "../__fixtures__/fixtures";
import { fakeOutbox, inSafeArea, perm, type FakeOutbox } from "../__fixtures__/screen-mocks";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: "success" } }));
jest.mock("expo-crypto", () => ({ randomUUID: (() => {
  let n = 0;
  return () => `uuid-${++n}`;
})() }));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: () => null, DateTimePickerAndroid: { open: jest.fn() } }));
let mockMeState: MeState;
jest.mock("@/features/shell", () => ({ ...jest.requireActual("@/features/shell"), useMe: () => mockMeState }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadSpaceBooking: jest.fn(), loadVehicleBooking: jest.fn() }));
jest.mock("../client", () => ({ bookingsFetch: jest.fn() }));
jest.mock("../capture", () => ({
  takeVehiclePhoto: jest.fn(async () => [{ localUri: "file:///shot.jpg", fileName: "shot.jpg", mimeType: "image/jpeg" }]),
  chooseVehiclePhotos: jest.fn(async () => []),
}));
let mockOutbox: FakeOutbox;
jest.mock("../outbox/provider", () => ({ useBookingsOutbox: () => ({ outbox: mockOutbox, items: mockOutbox.getItems(), online: true }) }));

const fetchMock = bookingsFetch as unknown as jest.Mock;
const spaceLoad = loadSpaceBooking as jest.Mock;
const vehicleLoad = loadVehicleBooking as jest.Mock;

function signedInAs(permissions: string[]) {
  mockMeState = { status: "ready", me: makeMe({ permissions: permissions.map(perm) }), error: null, refresh: jest.fn() };
}

/** Answer bookingsFetch by path; record calls. */
function routes(map: Record<string, unknown | ((init: { body?: unknown }) => unknown)>) {
  fetchMock.mockImplementation(async (path: string, init: { body?: unknown; schema?: { parse: (v: unknown) => unknown } } = {}) => {
    const r = map[path];
    if (r === undefined) throw new Error(`no route ${path}`);
    const v = typeof r === "function" ? (r as (i: unknown) => unknown)(init) : r;
    if (v instanceof Error) throw v;
    return init.schema ? init.schema.parse(v) : v;
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  spaceLoad.mockReset();
  vehicleLoad.mockReset();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  Object.values(mockRouter).forEach((f) => f.mockReset());
  mockOutbox = fakeOutbox();
  signedInAs(["bookings.view"]);
});

describe("Space booking detail", () => {
  it("loading, then the booking", async () => {
    let resolve: (v: unknown) => void = () => {};
    spaceLoad.mockReturnValue(new Promise((r) => (resolve = r)));
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    expect(screen.getByLabelText(strings.detail.loading)).toBeTruthy();
    resolve(spaceBooking());
    expect(await screen.findByText("Youth night")).toBeTruthy();
    expect(screen.getByLabelText("Space: Main hall · Base")).toBeTruthy();
  });

  it("gone or hidden by RLS: not found", async () => {
    spaceLoad.mockResolvedValue(null);
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    expect(await screen.findByTestId("not-found")).toBeTruthy();
  });

  it("error with retry", async () => {
    spaceLoad.mockRejectedValueOnce(new Error("Couldn't load this booking. Pull down to try again.")).mockResolvedValue(spaceBooking());
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    expect(await screen.findByText(/Couldn't load this booking/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Youth night")).toBeTruthy();
  });

  it("someone else's booking, not an approver: no actions", async () => {
    spaceLoad.mockResolvedValue(spaceBooking({ requested_by: "someone" }));
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    await screen.findByText("Youth night");
    expect(screen.queryByTestId("approve")).toBeNull();
    expect(screen.queryByTestId("cancel")).toBeNull();
  });

  it("my booking: cancel asks first, then cancels through the API", async () => {
    spaceLoad.mockResolvedValue(spaceBooking());
    routes({ "/api/bookings/sb1": { ok: true } });
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === "destructive")?.onPress?.());
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    await fireEvent.press(await screen.findByTestId("cancel"));
    expect(alert).toHaveBeenCalledWith(strings.detail.cancelConfirmTitle, expect.any(String), expect.any(Array));
    expect(await screen.findByText(strings.detail.cancelled)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/bookings/sb1", expect.objectContaining({ method: "PATCH", body: { cancel: true, applyToSeries: false } }));
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    alert.mockRestore();
  });

  it("a weekly booking offers cancelling every date", async () => {
    spaceLoad.mockResolvedValue(spaceBooking({ series_id: "ser1" }));
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    expect(await screen.findByTestId("cancel-series")).toBeTruthy();
  });

  it("approver: shows clashes from the server check (minus itself), then approves with a note", async () => {
    signedInAs(["bookings.approve"]);
    spaceLoad.mockResolvedValue(spaceBooking({ requested_by: "someone" }));
    routes({
      "/api/bookings": {
        ok: true,
        autoConfirm: true,
        blocked: true,
        conflicts: [
          { date: "2026-11-10", existingId: "sb1", existingTitle: "Youth night", existingTime: "18:00 – 21:00", occupiedUntil: "21:00", who: "Jo" },
          { date: "2026-11-10", existingId: "other", existingTitle: "Prayer meeting", existingTime: "19:00 – 20:00", occupiedUntil: "20:00", who: "Ana" },
        ],
      },
      "/api/bookings/sb1/decision": { ok: true },
    });
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    expect(await screen.findByText(/Prayer meeting \(Ana\)/)).toBeTruthy();
    expect(screen.queryByText(/Youth night \(Jo\)/)).toBeNull();
    await fireEvent.press(screen.getByTestId("approve"));
    await fireEvent.changeText(screen.getByTestId("decision-note"), "Fine, set up from 17:00");
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(strings.decision.approved)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bookings/sb1/decision",
      expect.objectContaining({ body: { decision: "approved", note: "Fine, set up from 17:00", applyToSeries: false } }),
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("approver: a refused decision keeps the sheet open with the server's reason", async () => {
    signedInAs(["bookings.approve"]);
    spaceLoad.mockResolvedValue(spaceBooking({ requested_by: "someone" }));
    routes({
      "/api/bookings": { ok: true, conflicts: [], autoConfirm: true, blocked: false },
      "/api/bookings/sb1/decision": new ServerRefusal("Booking not found", 404, {}),
    });
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    expect(await screen.findByText(strings.detail.noClash)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("decline"));
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText("Booking not found")).toBeTruthy();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});

describe("Vehicle booking detail", () => {
  const detail = (over: Record<string, unknown> = {}, inspections: unknown[] = []) => ({ booking: vehicleBooking(over), inspections });

  it("shows drivers and their test status, outside drivers' documents", async () => {
    vehicleLoad.mockResolvedValue(
      detail({
        drivers: [
          { id: "d1", user_id: "p1", name: "Sam Driver", driving_test_status: "pending" },
          { id: "d2", user_id: null, name: "Visitor Vee", license_file_url: "x", passport_file_url: null },
        ],
      }),
    );
    await render(inSafeArea(<VehicleDetailScreen id="vb1" />));
    expect(await screen.findByText("Sam Driver")).toBeTruthy();
    expect(screen.getByText(strings.detail.driverTest.pending)).toBeTruthy();
    expect(screen.getByText("Licence photo attached · No passport photo")).toBeTruthy();
  });

  it("vehicle approver: a refused approval shows the licence reason in the sheet", async () => {
    signedInAs(["vehicles.approve"]);
    vehicleLoad.mockResolvedValue(detail({ requested_by: "someone" }));
    routes({ "/api/vehicles/bookings/vb1/decision": new ServerRefusal("Can't approve — Sam: Still needs to pass the base-vehicle driving test.", 409, {}) });
    await render(inSafeArea(<VehicleDetailScreen id="vb1" />));
    await fireEvent.press(await screen.findByTestId("approve"));
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(/Still needs to pass the base-vehicle driving test/)).toBeTruthy();
  });

  it("vehicle approver: decline goes through with a haptic", async () => {
    signedInAs(["vehicles.approve"]);
    vehicleLoad.mockResolvedValue(detail({ requested_by: "someone" }));
    routes({ "/api/vehicles/bookings/vb1/decision": { ok: true } });
    await render(inSafeArea(<VehicleDetailScreen id="vb1" />));
    await fireEvent.press(await screen.findByTestId("decline"));
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(strings.decision.declined)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/vehicles/bookings/vb1/decision", expect.objectContaining({ body: { decision: "denied", note: null } }));
  });

  it("approved and mine: record collection; return waits on nothing but its own check", async () => {
    vehicleLoad.mockResolvedValue(detail({ status: "approved" }));
    await render(inSafeArea(<VehicleDetailScreen id="vb1" />));
    await fireEvent.press(await screen.findByTestId("record-collection"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/bookings/vehicle/[id]/[kind]", params: { id: "vb1", kind: "collection" } });
    expect(screen.getByTestId("record-return")).toBeTruthy();
  });

  it("pending: no checks yet; not mine and not a manager: no cancel", async () => {
    vehicleLoad.mockResolvedValue(detail({ requested_by: "someone" }));
    await render(inSafeArea(<VehicleDetailScreen id="vb1" />));
    await screen.findByRole("header", { name: "Airport run" });
    expect(screen.queryByTestId("record-collection")).toBeNull();
    expect(screen.queryByTestId("cancel")).toBeNull();
  });

  it("checkState: recorded, queued, or recordable", () => {
    const ins = [{ id: "i", kind: "collection" as const, mileage: 10, performed_at: "2026-11-10T08:00:00Z", damage_panels: [] }];
    expect(checkState("collection", ins, false, { status: "approved", mayInspect: true })).toMatchObject({ canRecord: false, recorded: { id: "i" } });
    expect(checkState("return", ins, false, { status: "approved", mayInspect: true }).canRecord).toBe(true);
    expect(checkState("return", ins, true, { status: "approved", mayInspect: true }).canRecord).toBe(false);
    expect(checkState("return", [], false, { status: "pending", mayInspect: true }).canRecord).toBe(false);
    expect(checkState("return", [], false, { status: "approved", mayInspect: false }).canRecord).toBe(false);
  });
});

describe("Collection / return check", () => {
  const approved = () => ({
    booking: vehicleBooking({
      status: "approved",
      assignments: [{ vehicle: { id: "veh1", name: "Quantum", registration_plate: "CA 123" } }],
      drivers: [{ id: "d1", user_id: "p1", name: "Sam Driver" }],
    }),
    inspections: [],
  });

  it("not the requester or a manager: permission denied", async () => {
    vehicleLoad.mockResolvedValue({ ...approved(), booking: { ...approved().booking, requested_by: "someone" } });
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="collection" />));
    expect(await screen.findByTestId("no-access")).toBeTruthy();
  });

  it("already recorded: says so", async () => {
    vehicleLoad.mockResolvedValue({ ...approved(), inspections: [{ id: "i", kind: "collection", mileage: 1, performed_at: "2026-11-10", damage_panels: [] }] });
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="collection" />));
    expect(await screen.findByTestId("already")).toBeTruthy();
  });

  it("seeds from the booking and checks the form before sending", async () => {
    vehicleLoad.mockResolvedValue(approved());
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="collection" />));
    expect(await screen.findByText("Vehicle: Quantum (CA 123)")).toBeTruthy();
    expect(screen.getByDisplayValue("Sam Driver")).toBeTruthy();
    expect(screen.getByDisplayValue("Airport run")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("submit-check"));
    expect(await screen.findByText("Please enter the vehicle mileage.")).toBeTruthy();
    expect(mockOutbox.add).not.toHaveBeenCalled();
  });

  it("a photo goes into the outbox at once; the form is sent and the screen closes", async () => {
    vehicleLoad.mockResolvedValue(approved());
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="collection" />));
    await fireEvent.changeText(await screen.findByTestId("mileage"), "12 345");
    await fireEvent.press(screen.getAllByRole("button", { name: `${strings.inspection.takePhoto}: ${strings.inspection.photos.damage_photo}` })[0]);
    await waitFor(() => expect(mockOutbox.add).toHaveBeenCalledTimes(1));
    expect(mockOutbox.add.mock.calls[0][0]).toMatchObject({ kind: "photo", photoKind: "damage_photo", bookingId: "vb1", inspectionKind: "collection", userId: "user-1" });
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[0]);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[1]);
    await fireEvent.press(screen.getByTestId("agree"));
    await fireEvent.press(screen.getByTestId("submit-check"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const form = mockOutbox.add.mock.calls[1][0];
    expect(form).toMatchObject({ kind: "form", payload: { kind: "collection", mileage: 12345, vehicle_id: "veh1", all_drivers_present: true, sa_license_confirmed: true, declaration_agreed: true } });
    expect(Haptics.notificationAsync).toHaveBeenCalled();
  });

  it("offline: saved on the phone, and the person is told", async () => {
    vehicleLoad.mockResolvedValue(approved());
    mockOutbox.onProcess = (items) => items; // nothing leaves the phone
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="collection" />));
    await fireEvent.changeText(await screen.findByTestId("mileage"), "100");
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[0]);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[1]);
    await fireEvent.press(screen.getByTestId("agree"));
    await fireEvent.press(screen.getByTestId("submit-check"));
    expect(await screen.findByText(strings.inspection.savedOffline)).toBeTruthy();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("a refused form stays on screen with the server's reason", async () => {
    vehicleLoad.mockResolvedValue(approved());
    mockOutbox.onProcess = (items) => items.map((i) => (i.kind === "form" ? { ...i, status: "failed" as const, lastError: "Not authorized" } : i));
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="collection" />));
    await fireEvent.changeText(await screen.findByTestId("mileage"), "100");
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[0]);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[1]);
    await fireEvent.press(screen.getByTestId("agree"));
    await fireEvent.press(screen.getByTestId("submit-check"));
    expect(await screen.findByText("Not authorized")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("return: the receipt section appears only when 'washed' is ticked, and is then required", async () => {
    vehicleLoad.mockResolvedValue({ ...approved(), inspections: [{ id: "i", kind: "collection", mileage: 1, performed_at: "2026-11-10", damage_panels: [] }] });
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="return" />));
    await screen.findByTestId("photos-damage_photo");
    expect(screen.queryByTestId("photos-carwash_receipt")).toBeNull();
    await fireEvent.press(screen.getByTestId("washed"));
    expect(screen.getByTestId("photos-carwash_receipt")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("mileage"), "200");
    await fireEvent.press(screen.getAllByRole("radio", { name: "Yes" })[0]);
    await fireEvent.press(screen.getByTestId("submit-check"));
    expect(await screen.findByText("Please attach the carwash receipt, or untick 'washed'.")).toBeTruthy();
  });

  it("photo helpers", () => {
    expect(photoSections("collection", { washed: true, fuelFull: true })).toEqual(["license", "damage_photo"]);
    expect(photoSections("return", { washed: true, fuelFull: true })).toEqual(["carwash_receipt", "fuel_gauge", "damage_photo"]);
    expect(attachedCounts([{ id: "a", kind: "fuel_gauge" }, { id: "b", kind: "fuel_gauge" }], new Set(["b"]))).toEqual({ fuel_gauge: 1 });
  });
});
