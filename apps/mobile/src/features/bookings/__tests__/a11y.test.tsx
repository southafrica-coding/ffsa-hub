// Accessibility checks for Bookings: every tappable has a role and a name on
// the main states of each screen, choices expose their state, and async
// results are spoken (docs/accessibility.md).

import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform, View } from "react-native";

import type { MeState } from "@/features/shell";
import { auditTappables } from "@/lib/a11y/testing";

import { makeMe } from "../../../../test/fixtures";
import { bookingsFetch } from "../client";
import { ConflictList } from "../components/ConflictList";
import { DateTimeField } from "../components/DateTimeField";
import { CheckRow, ChoiceRow, FormError, StatusLine } from "../components/ui";
import { loadMine, loadPending, loadSpaceBooking, loadSpaceOptions, loadVehicleBooking } from "../data";
import ApprovalsScreen from "../screens/ApprovalsScreen";
import BookingsHomeScreen from "../screens/BookingsHomeScreen";
import InspectionScreen from "../screens/InspectionScreen";
import NewRequestScreen from "../screens/NewRequestScreen";
import SpaceDetailScreen from "../screens/SpaceDetailScreen";
import VehicleDetailScreen from "../screens/VehicleDetailScreen";
import { strings } from "../strings";
import { spaceBooking, vehicleBooking } from "../__fixtures__/fixtures";
import { fakeOutbox, inSafeArea, perm, type FakeOutbox } from "../__fixtures__/screen-mocks";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: "success" } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-1" }));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: () => null, DateTimePickerAndroid: { open: jest.fn() } }));
let mockMeState: MeState = { status: "loading", me: null, error: null, refresh: jest.fn() };
jest.mock("@/features/shell", () => ({ ...jest.requireActual("@/features/shell"), useMe: () => mockMeState }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({
  ...jest.requireActual("../data"),
  loadMine: jest.fn(),
  loadPending: jest.fn(),
  loadSpaceBooking: jest.fn(),
  loadVehicleBooking: jest.fn(),
  loadSpaceOptions: jest.fn(),
  loadVehicles: jest.fn(),
}));
jest.mock("../client", () => ({ bookingsFetch: jest.fn() }));
jest.mock("../capture", () => ({ takeVehiclePhoto: jest.fn(async () => []), chooseVehiclePhotos: jest.fn(async () => []) }));
let mockOutbox: FakeOutbox;
jest.mock("../outbox/provider", () => ({ useBookingsOutbox: () => ({ outbox: mockOutbox, items: mockOutbox.getItems(), online: true }) }));

const mine = loadMine as jest.Mock;
const pending = loadPending as jest.Mock;
const spaceLoad = loadSpaceBooking as jest.Mock;
const vehicleLoad = loadVehicleBooking as jest.Mock;
const spaceOptions = loadSpaceOptions as jest.Mock;
const fetchMock = bookingsFetch as unknown as jest.Mock;

function signedInAs(permissions: string[]) {
  mockMeState = { status: "ready", me: makeMe({ permissions: permissions.map(perm) }), error: null, refresh: jest.fn() };
}

const noProblems = () => expect(auditTappables(screen.container as never)).toEqual([]);

let speak: jest.SpyInstance;
let speakQueued: jest.SpyInstance;
beforeEach(() => {
  [mine, pending, spaceLoad, vehicleLoad, spaceOptions, fetchMock].forEach((m) => m.mockReset());
  Object.values(mockRouter).forEach((f) => f.mockReset());
  mockOutbox = fakeOutbox();
  speak = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  speakQueued = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  Platform.OS = "ios";
});
afterEach(() => {
  speak.mockRestore();
  speakQueued.mockRestore();
});
const spoken = () => [...speak.mock.calls, ...speakQueued.mock.calls].map((c) => c[0] as string);

describe("Bookings home and approvals: every state is labelled", () => {
  it("loading and permission denied", async () => {
    mockMeState = { status: "loading", me: null, error: null, refresh: jest.fn() };
    const { rerender } = await render(inSafeArea(<BookingsHomeScreen />));
    expect(screen.getByRole("progressbar", { name: strings.home.loading })).toBeTruthy();
    signedInAs(["events.view"]);
    await rerender(inSafeArea(<BookingsHomeScreen />));
    expect(screen.getByRole("header", { name: strings.home.noAccessTitle })).toBeTruthy();
    noProblems();
  });

  it("empty: the New request button is a named button", async () => {
    signedInAs(["bookings.view", "bookings.request"]);
    mine.mockResolvedValue({ spaces: [], vehicles: [] });
    await render(inSafeArea(<BookingsHomeScreen />));
    await screen.findByText(strings.home.empty);
    const btn = screen.getByRole("button", { name: strings.home.newRequest });
    expect(btn.props.accessibilityHint).toBe(strings.home.newRequestHint);
    noProblems();
  });

  it("error: the retry is reachable", async () => {
    signedInAs(["bookings.view"]);
    mine.mockRejectedValue(new Error("Couldn't load your space bookings. Pull down to try again."));
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    noProblems();
  });

  it("success with the band: rows say kind, title, place, dates and status", async () => {
    signedInAs(["bookings.view", "bookings.approve"]);
    mine.mockResolvedValue({ spaces: [spaceBooking({ booking_date: "2099-01-10" })], vehicles: [] });
    pending.mockResolvedValue({ spaces: [spaceBooking()], vehicles: [] });
    await render(inSafeArea(<BookingsHomeScreen />));
    await screen.findByText(strings.home.needsYou(1));
    const row = screen.getByTestId("booking-space-sb1");
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toMatch(/Youth night/);
    expect(row.props.accessibilityLabel).toMatch(/Waiting/i);
    expect(screen.getByRole("button", { name: strings.home.review })).toBeTruthy();
    noProblems();
  });

  it("approvals: denied, empty", async () => {
    signedInAs(["bookings.view"]);
    const { rerender } = await render(inSafeArea(<ApprovalsScreen />));
    expect(screen.getByRole("header", { name: strings.approvals.noAccessTitle })).toBeTruthy();
    signedInAs(["bookings.approve"]);
    pending.mockResolvedValue({ spaces: [], vehicles: [] });
    await rerender(inSafeArea(<ApprovalsScreen />));
    expect(await screen.findByRole("header", { name: strings.approvals.emptyTitle })).toBeTruthy();
    noProblems();
  });
});

describe("Detail screens", () => {
  it("space detail for an approver: approve / decline buttons, decision sheet labelled, result spoken", async () => {
    signedInAs(["bookings.approve"]);
    spaceLoad.mockResolvedValue(spaceBooking({ requested_by: "someone" }));
    fetchMock.mockImplementation(async (path: string, init: { schema?: { parse: (v: unknown) => unknown } } = {}) => {
      const v = path.endsWith("/decision") ? { ok: true } : { ok: true, autoConfirm: false, blocked: false, conflicts: [] };
      return init.schema ? init.schema.parse(v) : v;
    });
    await render(inSafeArea(<SpaceDetailScreen id="sb1" />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.detail.approve }));
    expect(screen.getByLabelText(strings.decision.noteLabel)).toBeTruthy();
    noProblems();
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    await screen.findByText(strings.decision.approved);
    expect(spoken()).toContain(strings.decision.approved);
  });

  it("vehicle detail: drivers read as one unit each, checks are headed", async () => {
    vehicleLoad.mockResolvedValue({
      booking: vehicleBooking({ status: "approved", drivers: [{ id: "d1", user_id: "p1", name: "Sam Driver", driving_test_status: "pending" }] }),
      inspections: [],
    });
    await render(inSafeArea(<VehicleDetailScreen id="vb1" />));
    expect(await screen.findByRole("header", { name: strings.detail.collectionLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.detail.recordCollection })).toBeTruthy();
    noProblems();
  });

  it("inspection: checkboxes and yes/no radios expose state; a failed check is spoken", async () => {
    vehicleLoad.mockResolvedValue({
      booking: vehicleBooking({ status: "approved", assignments: [{ vehicle: { id: "veh1", name: "Quantum", registration_plate: "CA 1" } }] }),
      inspections: [],
    });
    await render(inSafeArea(<InspectionScreen bookingId="vb1" kind="return" />));
    const washed = await screen.findByRole("checkbox", { name: strings.inspection.washed });
    expect(washed.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getAllByRole("radio", { name: strings.inspection.yes }).length).toBeGreaterThan(0);
    expect(screen.getByRole("header", { name: strings.inspection.condition })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: new RegExp(`^${strings.inspection.takePhoto}: `) }).length).toBeGreaterThan(0);
    noProblems();
    await fireEvent.press(screen.getByTestId("submit-check"));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(spoken().length).toBeGreaterThan(0);
  });
});

describe("New request flow", () => {
  it("permission denied state is clean", async () => {
    signedInAs(["bookings.view"]);
    await render(inSafeArea(<NewRequestScreen />));
    expect(screen.getByTestId("no-request")).toBeTruthy();
    noProblems();
  });

  it("the step heading is a header; moving on announces the new step; spaces are radios", async () => {
    signedInAs(["bookings.view", "bookings.request"]);
    spaceOptions.mockResolvedValue({
      venues: [
        { id: "v1", name: "Main hall", building: "Base", capacity: 200, requires_approval: true },
        { id: "v2", name: "Prayer room", building: null, capacity: null, requires_approval: false },
      ],
      ministries: [],
    });
    await render(inSafeArea(<NewRequestScreen />));
    expect(screen.getByRole("header", { name: strings.a11y.stepChanged(strings.home.newRequest, strings.steps.titles.type) })).toBeTruthy();
    noProblems();
    await fireEvent.press(screen.getByTestId("type-space"));
    const room = await screen.findByRole("radio", { name: /Prayer room/ });
    expect(room.props.accessibilityState).toMatchObject({ checked: false });
    expect(spoken().some((s) => s.includes(strings.steps.titles.space))).toBe(true);
    await fireEvent.press(room);
    expect(screen.getByRole("radio", { name: /Prayer room/ }).props.accessibilityState).toMatchObject({ checked: true, selected: true });
    noProblems();
  });
});

describe("Bookings components", () => {
  it("CheckRow: a taken vehicle reads as unavailable but keeps its checked state", async () => {
    await render(<CheckRow label="Quantum" checked={false} unavailable onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Quantum" }).props.accessibilityState).toEqual({ checked: false, disabled: true });
  });

  it("ChoiceRow is a radio with checked + selected", async () => {
    await render(
      <View accessibilityRole="radiogroup">
        <ChoiceRow selected accessibilityLabel="Main hall" onPress={() => {}}>
          <View />
        </ChoiceRow>
      </View>,
    );
    expect(screen.getByRole("radio", { name: "Main hall" }).props.accessibilityState).toEqual({ checked: true, selected: true });
  });

  it("StatusLine says the status in words, with the icon hidden", async () => {
    await render(<StatusLine status="denied" />);
    expect(screen.getByLabelText("Declined")).toBeTruthy();
  });

  it("DateTimeField is one button with label and value; the visual label isn't read twice", async () => {
    await render(inSafeArea(<DateTimeField mode="time" label="Start" value="18:00" onChange={() => {}} clearable />));
    expect(screen.getByRole("button", { name: "Start: 18:00" })).toBeTruthy();
    expect(screen.queryByText("Start")).toBeNull();
    expect(screen.getByRole("button", { name: `${strings.when.clear} Start` })).toBeTruthy();
    noProblems();
  });

  it("FormError is an alert, spoken on iOS (Android reads the live region)", async () => {
    await render(<FormError message="Pick a space first." />);
    expect(screen.getByRole("alert").props.accessibilityLiveRegion).toBe("assertive");
    expect(spoken()).toEqual(["Pick a space first."]);
  });

  it("FormError isn't spoken twice on Android", async () => {
    Platform.OS = "android";
    await render(<FormError message="Pick a space first." />);
    expect(spoken()).toEqual([]);
  });

  it("ConflictList is an alert whose heading is spoken on iOS", async () => {
    await render(
      <ConflictList
        blocked
        conflicts={[{ date: "2026-11-10", existingId: "x", existingTitle: "Practice", existingTime: "17:00 – 19:00", occupiedUntil: "19:00", who: "Ana" }]}
      />,
    );
    expect(screen.getByRole("alert", { name: strings.clash.blockedTitle })).toBeTruthy();
    expect(spoken()).toEqual([strings.clash.blockedTitle]);
  });
});
