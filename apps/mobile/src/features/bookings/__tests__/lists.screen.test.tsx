import { fireEvent, render, screen } from "@testing-library/react-native";

import type { MeState } from "@/features/shell";
import { ApiError } from "@/lib/api";

import { makeMe } from "../../../../test/fixtures";
import { loadMine, loadPending } from "../data";
import ApprovalsScreen from "../screens/ApprovalsScreen";
import BookingsHomeScreen from "../screens/BookingsHomeScreen";
import { strings } from "../strings";
import { spaceBooking, vehicleBooking } from "../__fixtures__/fixtures";
import { fakeOutbox, inSafeArea, perm, type FakeOutbox } from "../__fixtures__/screen-mocks";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
let mockMeState: MeState = { status: "loading", me: null, error: null, refresh: jest.fn() };
jest.mock("@/features/shell", () => ({ ...jest.requireActual("@/features/shell"), useMe: () => mockMeState }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadMine: jest.fn(), loadPending: jest.fn() }));
jest.mock("../client", () => ({ bookingsFetch: jest.fn() }));
let mockOutbox: FakeOutbox;
let mockOnline = true;
jest.mock("../outbox/provider", () => ({ useBookingsOutbox: () => ({ outbox: mockOutbox, items: mockOutbox.getItems(), online: mockOnline }) }));

const mine = loadMine as jest.Mock;
const pending = loadPending as jest.Mock;
const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock };

function signedInAs(permissions: string[]) {
  mockMeState = { status: "ready", me: makeMe({ permissions: permissions.map(perm) }), error: null, refresh: jest.fn() };
}

beforeEach(() => {
  mine.mockReset();
  pending.mockReset();
  cache.readCache.mockReset().mockResolvedValue(null);
  Object.values(mockRouter).forEach((f) => f.mockReset());
  mockOutbox = fakeOutbox();
  mockOnline = true;
});

describe("Bookings home", () => {
  it("loading: a skeleton while /api/me loads", async () => {
    mockMeState = { status: "loading", me: null, error: null, refresh: jest.fn() };
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(screen.getByLabelText(strings.home.loading)).toBeTruthy();
  });

  it("permission denied: says so plainly", async () => {
    signedInAs(["events.view"]);
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(screen.getByTestId("no-access")).toBeTruthy();
    expect(screen.getByText(strings.home.noAccessTitle)).toBeTruthy();
    expect(mine).not.toHaveBeenCalled();
  });

  it("empty: the friendly prompt and the New request button", async () => {
    signedInAs(["bookings.view", "vehicles.view", "vehicles.request"]);
    mine.mockResolvedValue({ spaces: [], vehicles: [] });
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText(strings.home.empty)).toBeTruthy();
    expect(screen.getByTestId("new-request")).toBeTruthy();
    // Not an approver: no band, no approvals row, no queue fetch.
    expect(screen.queryByTestId("needs-you")).toBeNull();
    expect(screen.queryByTestId("approvals-row")).toBeNull();
    expect(pending).not.toHaveBeenCalled();
  });

  it("view-only: no New request button", async () => {
    signedInAs(["bookings.view"]);
    mine.mockResolvedValue({ spaces: [], vehicles: [] });
    await render(inSafeArea(<BookingsHomeScreen />));
    await screen.findByText(strings.home.empty);
    expect(screen.queryByTestId("new-request")).toBeNull();
  });

  it("error: the message and a retry that loads again", async () => {
    signedInAs(["bookings.view"]);
    mine.mockRejectedValueOnce(new Error("Couldn't load your space bookings. Pull down to try again.")).mockResolvedValue({ spaces: [], vehicles: [] });
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText(/Couldn't load your space bookings/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(strings.home.empty)).toBeTruthy();
  });

  it("a 403 reads as 'not available on your account'", async () => {
    signedInAs(["bookings.view"]);
    mine.mockRejectedValue(new ApiError("forbidden", "x", 403));
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("success: grouped, status in words, rows open the right screen", async () => {
    signedInAs(["bookings.view", "bookings.request", "vehicles.view", "vehicles.request"]);
    mine.mockResolvedValue({
      spaces: [spaceBooking({ id: "s-wait", status: "pending", booking_date: "2099-01-10" }), spaceBooking({ id: "s-past", status: "approved", booking_date: "2020-01-01", title: "Old night" })],
      vehicles: [vehicleBooking({ id: "v-up", status: "approved", checkout_date: "2099-02-01", return_date: "2099-02-03" })],
    });
    await render(inSafeArea(<BookingsHomeScreen />));
    // The section and the row's status both say it, in words.
    expect((await screen.findAllByText(strings.home.sections.waiting)).length).toBe(2);
    expect(screen.getByText(strings.home.sections.upcoming)).toBeTruthy();
    expect(screen.getByText(strings.home.sections.past)).toBeTruthy();
    expect(screen.getByTestId("status-pending")).toBeTruthy();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId("booking-vehicle-v-up"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/bookings/vehicle/[id]", params: { id: "v-up" } });
    await fireEvent.press(screen.getByTestId("booking-space-s-wait"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/bookings/space/[id]", params: { id: "s-wait" } });
  });

  it("approver with requests waiting: exactly one yellow band, and it opens the queue", async () => {
    signedInAs(["bookings.view", "bookings.approve", "vehicles.view", "vehicles.approve"]);
    mine.mockResolvedValue({ spaces: [], vehicles: [] });
    pending.mockResolvedValue({ spaces: [spaceBooking()], vehicles: [vehicleBooking(), vehicleBooking({ id: "vb2" })] });
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText(strings.home.needsYou(3))).toBeTruthy();
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: strings.home.review }));
    expect(mockRouter.push).toHaveBeenCalledWith("/bookings/approvals");
  });

  it("approver with nothing waiting: no band", async () => {
    signedInAs(["bookings.approve"]);
    mine.mockResolvedValue({ spaces: [], vehicles: [] });
    pending.mockResolvedValue({ spaces: [], vehicles: [] });
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText(strings.home.approvalsRowSub(0))).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("offline: the saved list stays, with a note and a retry", async () => {
    signedInAs(["bookings.view"]);
    mockOnline = false;
    cache.readCache.mockResolvedValue({ savedAt: 1, data: { items: [{ kind: "space", id: "s1", title: "Saved night", place: "Hall", status: "approved", start: "2099-01-01", end: "2099-01-01", when: "All day", repeats: false }], pendingCount: null } });
    mine.mockRejectedValue(new ApiError("network", "Couldn't reach FFSA Hub."));
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText("Saved night")).toBeTruthy();
    expect(await screen.findByText(strings.common.offline)).toBeTruthy();
  });

  it("vehicle checks saved on the phone are listed with their state", async () => {
    signedInAs(["vehicles.view"]);
    mine.mockResolvedValue({ spaces: [], vehicles: [] });
    mockOutbox = fakeOutbox([
      {
        kind: "photo",
        id: "q1",
        userId: "user-1",
        bookingId: "vb1",
        bookingName: "Airport run",
        inspectionKind: "collection",
        photoKind: "damage_photo",
        localUri: "file:///x.jpg",
        fileName: "x.jpg",
        mimeType: "image/jpeg",
        status: "failed",
        attempts: 8,
        nextAttemptAt: 0,
        lastError: "This photo is too large to upload.",
        createdAt: 1,
      },
    ]);
    await render(inSafeArea(<BookingsHomeScreen />));
    expect(await screen.findByText(strings.queue.title)).toBeTruthy();
    // Shared outbox wording: "Needs you", the reason, and (after 8 tries) the next step.
    expect(screen.getByText("Needs you")).toBeTruthy();
    expect(screen.getByText(/^This photo is too large to upload\. Couldn't send after 8 tries/)).toBeTruthy();
  });
});

describe("Waiting for you (approvals)", () => {
  it("permission denied for non-approvers", async () => {
    signedInAs(["bookings.view", "bookings.request"]);
    await render(inSafeArea(<ApprovalsScreen />));
    expect(screen.getByTestId("no-access")).toBeTruthy();
  });

  it("loading, then all caught up", async () => {
    signedInAs(["bookings.approve"]);
    let resolve: (v: unknown) => void = () => {};
    pending.mockReturnValue(new Promise((r) => (resolve = r)));
    await render(inSafeArea(<ApprovalsScreen />));
    expect(screen.getByLabelText(strings.approvals.loading)).toBeTruthy();
    resolve({ spaces: [], vehicles: [] });
    expect(await screen.findByText(strings.approvals.empty)).toBeTruthy();
  });

  it("lists spaces and vehicles with who asked; only the queues this person decides are fetched", async () => {
    signedInAs(["vehicles.approve"]);
    pending.mockResolvedValue({ spaces: [], vehicles: [vehicleBooking({ requester_name: "Ana" })] });
    await render(inSafeArea(<ApprovalsScreen />));
    expect(await screen.findByText(/Requested by Ana/)).toBeTruthy();
    expect(pending).toHaveBeenCalledWith({ spaces: false, vehicles: true });
    await fireEvent.press(screen.getByTestId("booking-vehicle-vb1"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/bookings/vehicle/[id]", params: { id: "vb1" } });
  });

  it("error with retry", async () => {
    signedInAs(["bookings.approve"]);
    pending.mockRejectedValueOnce(new Error("Couldn't load space requests. Pull down to try again.")).mockResolvedValue({ spaces: [], vehicles: [] });
    await render(inSafeArea(<ApprovalsScreen />));
    expect(await screen.findByText(/Couldn't load space requests/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(strings.approvals.empty)).toBeTruthy();
  });
});
