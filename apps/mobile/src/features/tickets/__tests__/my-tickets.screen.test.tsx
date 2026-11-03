import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { MyTicketsScreen } from "../screens/MyTicketsScreen";
import { ticketCacheKey } from "../ticket-cache";
import { NOW, makeMe, makeTickets, ticketEvent } from "../testing/fixtures";

const mockPush = jest.fn();
let mockNet = { isConnected: true, isInternetReachable: true };

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
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
    await render(<MyTicketsScreen now={now} />);
    expect(screen.getByLabelText("Loading your tickets")).toBeTruthy();
  });

  it("success: upcoming listed, past collapsed until asked, rows open the ticket", async () => {
    api({});
    await render(<MyTicketsScreen now={now} />);
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
    await render(<MyTicketsScreen now={now} />);
    await screen.findByText("Send Night");
    await waitFor(async () => expect(await AsyncStorage.getItem(ticketCacheKey("u1"))).toContain("AbCdEfGhIjK"));
  });

  it("success: lists ticketless registrations, not as tickets", async () => {
    api({
      tickets: () =>
        makeTickets({ tickets: [], registrations: [{ id: "r1", status: "pending", event: ticketEvent("e5", "Prayer Day", "2026-11-25") }] }),
    });
    await render(<MyTicketsScreen now={now} />);
    expect(await screen.findByText("Prayer Day")).toBeTruthy();
    expect(screen.getByText("Registered · no ticket needed")).toBeTruthy();
    expect(screen.queryByText("Saved on this phone")).toBeNull();
  });

  it("empty: explains where tickets come from", async () => {
    api({ tickets: () => makeTickets({ tickets: [], registrations: [] }) });
    await render(<MyTicketsScreen now={now} />);
    expect(await screen.findByText("No tickets yet")).toBeTruthy();
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
    await render(<MyTicketsScreen now={now} />);
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
    await render(<MyTicketsScreen now={now} />);
    expect(await screen.findByText("Send Night")).toBeTruthy();
    expect(await screen.findByTestId("stale-banner")).toHaveTextContent(/You're offline\. Showing the tickets saved on this phone/);
  });

  it("needs-you band only from real data (an unsigned waiver), and only once", async () => {
    const waiverDue = {
      id: "t-w",
      code: "WaiverCode1",
      status: "valid",
      checkedInAt: null,
      ticketTypeName: "Youth",
      holderName: "Thandi",
      waiver: { required: true, signed: false, signedAt: null, title: "Consent", hasDocument: false },
      event: ticketEvent("e7", "Youth Camp", "2026-12-10"),
    };
    api({ tickets: () => makeTickets({ tickets: [waiverDue, { ...waiverDue, id: "t-w2", code: "WaiverCode2" }] }) });
    await render(<MyTicketsScreen now={now} />);
    await screen.findAllByText("Youth Camp");
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);

    api({});
    await render(<MyTicketsScreen now={now} />);
    await screen.findByText("Send Night");
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("permission: door check-in entry only for people the server would allow", async () => {
    api({ me: () => makeMe({ roles: ["events_admin"] }) });
    await render(<MyTicketsScreen now={now} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Run door check-in" }));
    expect(mockPush).toHaveBeenCalledWith("/tickets/check-in");
  });

  it("permission denied: no door entry for an ordinary member", async () => {
    api({ me: () => makeMe({ roles: ["staff"], viaRole: ["events.manage_attendance"] }) });
    await render(<MyTicketsScreen now={now} />);
    await screen.findByText("Send Night");
    expect(screen.queryByRole("button", { name: "Run door check-in" })).toBeNull();
  });
});
