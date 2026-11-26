import { fireEvent, render, screen } from "@testing-library/react-native";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { CheckInEventsScreen } from "../screens/CheckInEventsScreen";
import { makeMe } from "../testing/fixtures";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true, replace: jest.fn() }) }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));

const mockFetch = apiFetch as unknown as jest.Mock;

const EVENTS = {
  events: [
    { id: "e1", title: "Send Night", startDate: "2026-11-03", startTime: "18:00:00", endDate: null, endTime: null, location: "Cape Town" },
  ],
};

function api(handlers: { me?: () => unknown; events?: () => unknown }) {
  mockFetch.mockImplementation(async (path: string) => {
    if (path === "/api/me") return (handlers.me ?? (() => makeMe({ direct: ["events.manage_attendance"] })))();
    if (path === "/api/mobile/check-in-events") return (handlers.events ?? (() => EVENTS))();
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
});

describe("Check-in: pick an event", () => {
  it("loading", async () => {
    api({ events: () => new Promise(() => undefined) });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(screen.getByLabelText("Loading events")).toBeTruthy();
  });

  it("success: lists events and opens the door with the title", async () => {
    api({});
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    await fireEvent.press(await screen.findByRole("button", { name: /^Send Night\. Tue 3 Nov 2026 · 18:00\. Cape Town$/ }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/tickets/check-in/[eventId]",
      params: { eventId: "e1", title: "Send Night" },
    });
  });

  it("header: the Check-in title, and back to My tickets", async () => {
    api({});
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(screen.getByRole("header", { name: "Check-in" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to My tickets" }));
    expect(mockBack).toHaveBeenCalled();
  });

  it("success: rows say when and where, and carry no counts", async () => {
    api({});
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    const row = await screen.findByTestId("event-e1");
    expect(row).toHaveTextContent(/Send Night.*Tue 3 Nov 2026 · 18:00.*Cape Town/);
    expect(row).not.toHaveTextContent(/checked in|expected/i);
  });

  it("empty", async () => {
    api({ events: () => ({ events: [] }) });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(await screen.findByText("No events to check in")).toBeTruthy();
  });

  it("error with retry", async () => {
    let n = 0;
    api({
      events: () => {
        if (n++ === 0) throw new ApiError("timeout", "The server took too long to answer. Try again.");
        return EVENTS;
      },
    });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(await screen.findByText("The server took too long to answer. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Send Night")).toBeTruthy();
  });

  it("permission denied by the server (403)", async () => {
    api({
      events: () => {
        throw new ApiError("forbidden", "You don't have access to this.", 403);
      },
    });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(await screen.findByText("You can't run check-in")).toBeTruthy();
  });

  it("permission denied per /api/me (UX), even before the list arrives", async () => {
    api({ me: () => makeMe({ roles: ["staff"] }), events: () => new Promise(() => undefined) });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(await screen.findByText("You can't run check-in")).toBeTruthy();
  });

  it("if /api/me fails, the list still loads (the server decides)", async () => {
    api({
      me: () => {
        throw new ApiError("timeout", "The server took too long to answer. Try again.");
      },
    });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(await screen.findByText("Send Night")).toBeTruthy();
    expect(screen.queryByText("You can't run check-in")).toBeNull();
  });
});
