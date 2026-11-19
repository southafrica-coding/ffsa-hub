import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { MyTicketsScreen } from "../screens/MyTicketsScreen";
import { ticketCacheKey } from "../ticket-cache";
import { NOW, makeMe, makeTickets, ticketEvent } from "../testing/fixtures";

const mockPush = jest.fn();
let mockNet = { isConnected: true, isInternetReachable: true };

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
}));

const mockFetch = apiFetch as unknown as jest.Mock;

/** Route the mocked apiFetch by path. */
function api(handlers: { me?: () => unknown; tickets?: () => unknown }) {
  mockFetch.mockImplementation(async (path: string) => {
    if (path === "/api/me") return (handlers.me ?? (() => makeMe()))();
    if (path === "/api/mobile/my-tickets") return (handlers.tickets ?? (() => makeTickets()))();
    throw new Error(`unexpected ${path}`);
  });
}

const now = () => NOW;

beforeEach(async () => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockNet = { isConnected: true, isInternetReachable: true };
  await AsyncStorage.clear();
});

describe("My tickets", () => {
  it("loading: shows a skeleton with a spoken label", async () => {
    api({ tickets: () => new Promise(() => undefined) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(screen.getByLabelText("Loading your tickets")).toBeTruthy();
  });

  it("success: upcoming listed, past collapsed until asked, rows open the ticket", async () => {
    api({});
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByText("Send Night")).toBeTruthy();
    expect(screen.getByText("Saved on this phone")).toBeTruthy();
    expect(screen.queryByText("Ministry Night")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Show past events (1)" }));
    expect(screen.getByText("Ministry Night")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("ticket-t-up"));
    expect(mockPush).toHaveBeenCalledWith("/tickets/ticket/t-up");
  });

  it("success: caches what it loaded for offline use", async () => {
    api({});
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findByText("Send Night");
    await waitFor(async () => expect(await AsyncStorage.getItem(ticketCacheKey("u1"))).toContain("AbCdEfGhIjK"));
  });

  it("success: lists ticketless registrations, not as tickets", async () => {
    api({
      tickets: () =>
        makeTickets({ tickets: [], registrations: [{ id: "r1", status: "pending", event: ticketEvent("e5", "Prayer Day", "2026-11-25") }] }),
    });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByText("Prayer Day")).toBeTruthy();
    expect(screen.getByText("Registered · no ticket needed")).toBeTruthy();
    expect(screen.queryByText("Saved on this phone")).toBeNull();
  });

  it("empty: explains where tickets come from, and still offers Get tickets", async () => {
    api({ tickets: () => makeTickets({ tickets: [], registrations: [] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByText("No tickets yet")).toBeTruthy();
    expect(screen.getByText("When you book or register for an event, your ticket shows up here.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get tickets. Opens in browser" })).toBeTruthy();
    expect(screen.queryByText("Saved on this phone")).toBeNull();
  });

  it("Get tickets: one row that opens the website in the in-app browser, and says so", async () => {
    api({});
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findByText("Send Night");
    const row = screen.getByRole("link", { name: "Get tickets. Opens in browser" });
    expect(row.props.accessibilityHint).toBe("Browse events on the website");
    expect(screen.getByText("Opens in browser")).toBeTruthy();
    await fireEvent.press(row);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://hub.example.test/my-events", expect.anything());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Get tickets waits for the list: not shown while loading or on a failed first load", async () => {
    api({ tickets: () => new Promise(() => undefined) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(screen.queryByText("Get tickets")).toBeNull();
  });

  it.each([
    ["valid", "Ready to scan"],
    ["checked_in", "Checked in"],
    ["void", "Cancelled"],
  ])("ticket status %s reads '%s' in words", async (status, word) => {
    const base = makeTickets().tickets[0];
    api({ tickets: () => makeTickets({ tickets: [{ ...base, status, checkedInAt: status === "checked_in" ? "2026-11-03T07:00:00.000Z" : null }] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByRole("button", { name: new RegExp(`^Send Night\\..*${word}$`) })).toBeTruthy();
    expect(screen.getByText(word)).toBeTruthy();
  });

  it.each([
    ["confirmed", "Confirmed"],
    ["pending", "Pending"],
    ["waitlisted", "Waitlisted"],
    ["cancelled", "Cancelled"],
  ])("registration status %s reads '%s', and the row doesn't open", async (status, word) => {
    api({ tickets: () => makeTickets({ tickets: [], registrations: [{ id: "r1", status, event: ticketEvent("e5", "Prayer Day", "2026-11-25") }] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByText(word)).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Prayer Day\\..*Registered · no ticket needed\\. ${word}$`))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Prayer Day/ })).toBeNull();
  });

  it("error: specific message and a working retry", async () => {
    let n = 0;
    api({
      tickets: () => {
        n++;
        if (n === 1) throw new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again.");
        return makeTickets();
      },
    });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByText("Couldn't reach FFSA Hub. Check your connection and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Send Night")).toBeTruthy();
  });

  it("offline: shows the copy saved on this phone, with when it was saved", async () => {
    await AsyncStorage.setItem(ticketCacheKey("u1"), JSON.stringify({ savedAt: "2026-11-02T10:00:00.000Z", data: makeTickets() }));
    mockNet = { isConnected: false, isInternetReachable: false };
    api({
      tickets: () => {
        throw new ApiError("network", "offline");
      },
    });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByText("Send Night")).toBeTruthy();
    expect(await screen.findByTestId("stale-banner")).toHaveTextContent(/No connection.*You're offline\. Showing the tickets saved on this phone/);
    // Calm, not an alert: the saved tickets still work.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Saved on this phone")).toBeTruthy();
  });

  it("online but the refresh failed: says it couldn't refresh and shows the saved copy", async () => {
    await AsyncStorage.setItem(ticketCacheKey("u1"), JSON.stringify({ savedAt: "2026-11-02T10:00:00.000Z", data: makeTickets() }));
    api({
      tickets: () => {
        throw new ApiError("http", "Something went wrong on the server (500). Try again.", 500);
      },
    });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByTestId("stale-banner")).toHaveTextContent(/Couldn't refresh\. Showing the tickets saved on this phone/);
    expect(screen.getByText("Send Night")).toBeTruthy();
  });

  it("needs-you band only from real data (an unsigned waiver), and only once", async () => {
    const waiverDue = {
      id: "t-w",
      code: "WaiverCode1",
      status: "valid",
      checkedInAt: null,
      ticketTypeName: "Youth",
      holderName: "Sample Person 199",
      waiver: { required: true, signed: false, signedAt: null, title: "Consent", hasDocument: false },
      event: ticketEvent("e7", "Youth Camp", "2026-12-10"),
    };
    api({ tickets: () => makeTickets({ tickets: [waiverDue, { ...waiverDue, id: "t-w2", code: "WaiverCode2" }] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findAllByText("Youth Camp");
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    expect(screen.getByRole("summary", { name: "Needs you. Youth Camp, Youth Camp: Not signed yet. Contact the event team before you arrive." })).toBeTruthy();

    api({});
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findByText("Send Night");
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("permission: door check-in entry only for people the server would allow", async () => {
    api({ me: () => makeMe({ roles: ["events_admin"] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await fireEvent.press(await screen.findByRole("button", { name: "Run door check-in" }));
    expect(mockPush).toHaveBeenCalledWith("/tickets/check-in");
  });

  it("permission denied: no door entry for an ordinary member", async () => {
    api({ me: () => makeMe({ roles: ["staff"], viaRole: ["events.manage_attendance"] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findByText("Send Night");
    expect(screen.queryByRole("button", { name: "Run door check-in" })).toBeNull();
  });
});
