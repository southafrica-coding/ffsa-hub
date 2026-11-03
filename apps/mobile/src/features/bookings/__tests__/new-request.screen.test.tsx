import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import type { MeState } from "@/features/shell";

import { makeMe } from "../../../../test/fixtures";
import { bookingsFetch } from "../client";
import { loadSpaceOptions, loadVehicles } from "../data";
import { ServerRefusal } from "../http";
import NewRequestScreen from "../screens/NewRequestScreen";
import { strings } from "../strings";
import { person } from "../__fixtures__/fixtures";
import { inSafeArea, perm } from "../__fixtures__/screen-mocks";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "p1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: "success" } }));
let mockMeState: MeState;
jest.mock("@/features/shell", () => ({ ...jest.requireActual("@/features/shell"), useMe: () => mockMeState }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadSpaceOptions: jest.fn(), loadVehicles: jest.fn() }));
jest.mock("../client", () => ({ bookingsFetch: jest.fn() }));
// The native pickers are replaced by a button that sets a fixed value per field.
const mockValues: Record<string, string> = { date: "2026-11-10", start: "18:00", end: "21:00", checkout: "2026-11-10", return: "2026-11-12" };
jest.mock("../components/DateTimeField", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    DateTimeField: ({ testID, label, value, onChange }: { testID?: string; label: string; value: string; onChange: (v: string) => void }) => (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => onChange(mockValues[testID ?? ""] ?? "")}>
        <Text>{value || "not set"}</Text>
      </Pressable>
    ),
  };
});

const fetchMock = bookingsFetch as unknown as jest.Mock;
const spaceOptions = loadSpaceOptions as jest.Mock;
const fleet = loadVehicles as jest.Mock;

function signedInAs(permissions: string[]) {
  mockMeState = {
    status: "ready",
    me: makeMe({ user: { id: "p1", email: "sam@example.org" }, profile: { firstName: "Sam", lastName: "Driver", preferredName: null, avatarUrl: null, isActive: true }, permissions: permissions.map(perm) }),
    error: null,
    refresh: jest.fn(),
  };
}

type Init = { body?: Record<string, unknown>; schema?: { parse: (v: unknown) => unknown } };
function routes(handler: (path: string, init: Init) => unknown) {
  fetchMock.mockImplementation(async (path: string, init: Init = {}) => {
    const v = handler(path, init);
    if (v instanceof Error) throw v;
    return init.schema ? init.schema.parse(v) : v;
  });
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));

beforeEach(() => {
  fetchMock.mockReset();
  spaceOptions.mockReset().mockResolvedValue({
    venues: [
      { id: "v1", name: "Main hall", building: "Base", capacity: 200, requires_approval: true },
      { id: "v2", name: "Prayer room", building: null, capacity: null, requires_approval: false },
    ],
    ministries: [{ id: "m1", name: "Youth" }],
  });
  fleet.mockReset().mockResolvedValue([
    { id: "car1", name: "Quantum", vehicle_type: "van", make_model: "Toyota", seats: 14, registration_plate: "CA 1" },
    { id: "car2", name: "Polo", vehicle_type: "car", make_model: null, seats: 5, registration_plate: null },
  ]);
  Object.values(mockRouter).forEach((f) => f.mockReset());
  (Haptics.notificationAsync as jest.Mock).mockClear();
});

describe("New request: what can be asked for", () => {
  it("only the types this account may request; equipment points to the website", async () => {
    signedInAs(["bookings.view", "vehicles.view", "vehicles.request", "equipment.view"]);
    await render(inSafeArea(<NewRequestScreen />));
    expect(screen.getByText(strings.steps.of(1, 1))).toBeTruthy();
    expect(screen.queryByTestId("type-space")).toBeNull();
    expect(screen.getByTestId("type-vehicle")).toBeTruthy();
    expect(screen.getByText(strings.type.equipmentNotYet)).toBeTruthy();
  });

  it("permission denied: can't request anything", async () => {
    signedInAs(["bookings.view"]);
    await render(inSafeArea(<NewRequestScreen />));
    expect(screen.getByTestId("no-request")).toBeTruthy();
  });
});

describe("New request: a space", () => {
  async function toWhen() {
    signedInAs(["bookings.view", "bookings.request"]);
    await render(inSafeArea(<NewRequestScreen />));
    await press("type-space");
    await fireEvent.press(await screen.findByTestId("venue-v2"));
    expect(screen.getByText(/Instant confirmation/)).toBeTruthy();
    await press("step-next");
    await press("date");
    await press("start");
    await press("end");
  }

  it("a clash on an instant space is a hard block, in the server's words", async () => {
    routes((path, init) => {
      expect(path).toBe("/api/bookings");
      expect(init.body).toMatchObject({ dryRun: true, venue_id: "v2", booking_date: "2026-11-10", start_time: "18:00", end_time: "21:00" });
      return {
        ok: true,
        autoConfirm: true,
        blocked: true,
        conflicts: [{ date: "2026-11-10", existingId: "x", existingTitle: "Worship practice", existingTime: "17:00 – 19:00", occupiedUntil: "19:00", who: "Ana" }],
      };
    });
    await toWhen();
    expect(await screen.findByTestId("clash-blocked", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/Worship practice \(Ana\), 17:00 – 19:00, holds it until 19:00/)).toBeTruthy();
    await press("step-next");
    expect(screen.getByText(strings.clash.changeToContinue)).toBeTruthy();
    // Still on "When?".
    expect(screen.getByRole("header", { name: strings.steps.titles.when })).toBeTruthy();
  });

  it("free: through details and review to a confirmed booking", async () => {
    routes((path, init) => {
      if (init.body?.dryRun) return { ok: true, autoConfirm: true, blocked: false, conflicts: [] };
      return { ok: true, bookingId: "new-1", autoConfirm: true, conflicts: [] };
    });
    await toWhen();
    expect(await screen.findByTestId("space-free", {}, { timeout: 3000 })).toBeTruthy();
    await press("step-next");
    // Details: the event name is required.
    await press("step-next");
    expect(screen.getByText("Please enter an event name.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("title"), "Youth night");
    expect(screen.getByDisplayValue("Sam Driver")).toBeTruthy();
    await press("step-next");
    expect(screen.getByRole("header", { name: strings.steps.titles.review })).toBeTruthy();
    expect(await screen.findByRole("button", { name: strings.steps.confirm }, { timeout: 3000 })).toBeTruthy();
    await press("submit");
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/bookings/space/[id]", params: { id: "new-1" } });
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    const create = fetchMock.mock.calls.find((c) => (c[1] as Init).body?.dryRun === false);
    expect(create?.[1].body).toMatchObject({ title: "Youth night", requester_name: "Sam Driver", venue_id: "v2" });
  });

  it("the server can still refuse at the last moment (someone booked it meanwhile)", async () => {
    routes((_path, init) => {
      if (init.body?.dryRun) return { ok: true, autoConfirm: true, blocked: false, conflicts: [] };
      return new ServerRefusal("That time is already booked — “Staff meeting” has this space on Tue 10 Nov 2026 until 20:00.", 409, {
        blocked: true,
        conflicts: [{ date: "2026-11-10", existingId: "y", existingTitle: "Staff meeting", existingTime: "19:00 – 20:00", occupiedUntil: "20:00", who: null }],
      });
    });
    await toWhen();
    await screen.findByTestId("space-free", {}, { timeout: 3000 });
    await press("step-next");
    await fireEvent.changeText(screen.getByTestId("title"), "Youth night");
    await press("step-next");
    await screen.findByRole("button", { name: strings.steps.confirm }, { timeout: 3000 });
    await press("submit");
    expect(await screen.findByText(/That time is already booked/)).toBeTruthy();
    expect(screen.getByTestId("clash-blocked")).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("back walks the steps, then closes", async () => {
    signedInAs(["bookings.request"]);
    await render(inSafeArea(<NewRequestScreen />));
    await press("type-space");
    await screen.findByTestId("venue-v1");
    await press("step-back");
    expect(screen.getByTestId("type-space")).toBeTruthy();
  });
});

describe("New request: a vehicle", () => {
  it("taken vehicles are marked from the server's check; drivers need a valid licence; the server's refusal is shown", async () => {
    signedInAs(["vehicles.view", "vehicles.request"]);
    routes((path, init) => {
      if (path === "/api/vehicles/people") {
        return { people: [person({ id: "p1", name: "Sam Driver" }), person({ id: "p2", name: "Lee Expired", licence_expiry_date: "2026-11-11" })] };
      }
      if (init.body?.dryRun) return { ok: true, unavailableVehicleIds: ["car1"], clashingVehicleIds: [], blocked: false };
      return new ServerRefusal("Sam Driver cannot be added as a driver — No passport photo on file. Ask them to add one to their profile.", 400, {});
    });
    await render(inSafeArea(<NewRequestScreen />));
    await press("type-vehicle");
    await press("checkout");
    await press("return");
    expect(screen.getByText(strings.when.days(3))).toBeTruthy();
    await press("step-next");
    // car1 is booked for those dates.
    expect(await screen.findByText(/Booked for those dates/, {}, { timeout: 3000 })).toBeTruthy();
    await press("vehicle-car1");
    expect(screen.getByRole("checkbox", { name: "Quantum" }).props.accessibilityState.checked).toBe(false);
    await press("vehicle-car2");
    await press("step-next");
    // Drivers.
    await press("step-next");
    expect(screen.getByText("Add at least one driver.")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("add-driver"));
    await fireEvent.press(screen.getByTestId("person-p2"));
    await press("step-next");
    expect(screen.getByText(/Lee Expired cannot be added as a driver: Licence expires on 2026-11-11, before the return date/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.drivers.remove("Lee Expired") }));
    await press("add-me");
    await press("step-next");
    // Details.
    await fireEvent.changeText(screen.getByTestId("booking-name"), "Airport run");
    await fireEvent.changeText(screen.getByTestId("point-person"), "Jo");
    await fireEvent.changeText(screen.getByTestId("destination"), "Cape Town airport");
    await press("step-next");
    expect(screen.getByRole("header", { name: strings.steps.titles.review })).toBeTruthy();
    await press("submit");
    expect(await screen.findByText(/No passport photo on file/)).toBeTruthy();
    const create = fetchMock.mock.calls.find((c) => c[0] === "/api/vehicles/bookings" && !(c[1] as Init).body?.dryRun);
    expect(create?.[1].body).toMatchObject({
      booking_name: "Airport run",
      vehicle_ids: ["car2"],
      requester_email: "sam@example.org",
      home_country: "ZA",
      drivers: [{ user_id: "p1", name: "Sam Driver", has_sa_license: true, is_first_time: false }],
    });
  });

  it("created: opens the new booking", async () => {
    signedInAs(["vehicles.request"]);
    routes((path, init) => {
      if (path === "/api/vehicles/people") return { people: [person({ id: "p1" })] };
      if (init.body?.dryRun) return { ok: true, unavailableVehicleIds: [], clashingVehicleIds: [], blocked: false };
      return { ok: true, bookingId: "vb-new", drivers: [{ id: "d1", name: "Sam Driver" }] };
    });
    fleet.mockResolvedValue([]);
    await render(inSafeArea(<NewRequestScreen />));
    await press("type-vehicle");
    await press("checkout");
    await press("return");
    await press("step-next");
    expect(await screen.findByText(strings.vehicle.noFleet)).toBeTruthy();
    await press("step-next");
    await fireEvent.press(await screen.findByTestId("add-me"));
    await press("step-next");
    await fireEvent.changeText(screen.getByTestId("booking-name"), "Trip");
    await fireEvent.changeText(screen.getByTestId("point-person"), "Jo");
    await fireEvent.changeText(screen.getByTestId("destination"), "Durban");
    await press("step-next");
    await press("submit");
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/bookings/vehicle/[id]", params: { id: "vb-new" } });
  });
});
