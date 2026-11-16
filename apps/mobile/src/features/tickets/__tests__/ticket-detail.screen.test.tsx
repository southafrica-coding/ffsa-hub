import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Brightness from "expo-brightness";
import * as WebBrowser from "expo-web-browser";

import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { TicketDetailScreen } from "../screens/TicketDetailScreen";
import { ticketCacheKey } from "../ticket-cache";
import { makeTickets, ticketEvent } from "../testing/fixtures";

let mockNet = { isConnected: true, isInternetReachable: true };
jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
}));
jest.mock("expo-brightness", () => ({
  getBrightnessAsync: jest.fn(async () => 0.4),
  setBrightnessAsync: jest.fn(async () => undefined),
  restoreSystemBrightnessAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("react-native-qrcode-svg", () => {
  // jest.mock factories run before imports, so require() is the only way in.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return function QRCode(props: { value: string }) {
    return <View testID="qr-svg" accessibilityValue={{ text: props.value }} />;
  };
});

const mockFetch = apiFetch as unknown as jest.Mock;

const signedTicket = {
  id: "t-w",
  code: "WaiverCode1",
  status: "valid",
  checkedInAt: null,
  ticketTypeName: "Youth",
  holderName: "Sample Person 199",
  waiver: { required: true, signed: true, signedAt: "2026-10-01T10:00:00Z", title: "Consent", hasDocument: true },
  event: ticketEvent("e7", "Youth Camp", "2026-12-10"),
};

beforeEach(async () => {
  mockFetch.mockReset();
  jest.clearAllMocks();
  mockNet = { isConnected: true, isInternetReachable: true };
  await AsyncStorage.clear();
});

describe("Ticket detail", () => {
  it("loading", async () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));
    await render(<TicketDetailScreen ticketId="t-up" />);
    expect(screen.getByLabelText("Loading your tickets")).toBeTruthy();
  });

  it("success: big QR from the code, the code in mono, event details, brightness up then restored", async () => {
    mockFetch.mockResolvedValue(makeTickets());
    const view = await render(<TicketDetailScreen ticketId="t-up" />);
    expect(await screen.findByText("Send Night")).toBeTruthy();
    expect(screen.getByTestId("qr-svg").props.accessibilityValue).toEqual({ text: "AbCdEfGhIjK" });
    expect(screen.getByTestId("ticket-code", { includeHiddenElements: true })).toHaveTextContent("AbCdEfGhIjK");
    expect(screen.getByLabelText(/^Ticket QR code\. Code A b C d/)).toBeTruthy();
    expect(screen.getByText("Saved on this phone")).toBeTruthy();
    expect(screen.getByLabelText("Ticket holder: Sample Person 199")).toBeTruthy();
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));

    await view.unmount();
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4));
  });

  it("works offline from the copy saved on this phone", async () => {
    await AsyncStorage.setItem(ticketCacheKey("u1"), JSON.stringify({ savedAt: "2026-11-02T10:00:00.000Z", data: makeTickets() }));
    mockNet = { isConnected: false, isInternetReachable: false };
    mockFetch.mockRejectedValue(new ApiError("network", "offline"));
    await render(<TicketDetailScreen ticketId="t-up" />);
    expect(await screen.findByTestId("ticket-code", { includeHiddenElements: true })).toHaveTextContent("AbCdEfGhIjK");
    expect(screen.getByText("Saved on this phone")).toBeTruthy();
  });

  it("already checked in: says when", async () => {
    mockFetch.mockResolvedValue(makeTickets());
    await render(<TicketDetailScreen ticketId="t-past" />);
    expect(await screen.findByText(/^Checked in at \d\d:\d\d$/)).toBeTruthy();
  });

  it("cancelled ticket: explains, QR dimmed, no brightness boost", async () => {
    mockFetch.mockResolvedValue(
      makeTickets({ tickets: [{ ...signedTicket, id: "t-void", status: "void", waiver: undefined }] }),
    );
    await render(<TicketDetailScreen ticketId="t-void" />);
    expect(await screen.findByText(/cancelled or refunded/)).toBeTruthy();
    expect(Brightness.setBrightnessAsync).not.toHaveBeenCalled();
  });

  it("waiver: shows status and opens the signed copy in the in-app browser", async () => {
    mockFetch.mockImplementation(async (path: string) =>
      path === "/api/mobile/my-tickets" ? makeTickets({ tickets: [signedTicket] }) : { url: "https://storage.test/w.pdf?t=1" },
    );
    await render(<TicketDetailScreen ticketId="t-w" />);
    expect(await screen.findByLabelText("Waiver · Consent: Signed Thu 1 Oct 2026")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "View signed waiver" }));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://storage.test/w.pdf?t=1"));
    expect(mockFetch).toHaveBeenCalledWith("/api/mobile/my-tickets/WaiverCode1/waiver", expect.anything());
  });

  it("waiver: a failure to open says what to do", async () => {
    mockFetch.mockImplementation(async (path: string) => {
      if (path === "/api/mobile/my-tickets") return makeTickets({ tickets: [signedTicket] });
      throw new ApiError("network", "x");
    });
    await render(<TicketDetailScreen ticketId="t-w" />);
    await fireEvent.press(await screen.findByRole("button", { name: "View signed waiver" }));
    expect(await screen.findByText("Couldn't open the waiver. Check your connection and try again.")).toBeTruthy();
  });

  it("not found", async () => {
    mockFetch.mockResolvedValue(makeTickets());
    await render(<TicketDetailScreen ticketId="nope" />);
    expect(await screen.findByText("Ticket not found")).toBeTruthy();
  });

  it("error with retry", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError("http", "Something went wrong on the server (500). Try again.", 500));
    mockFetch.mockResolvedValueOnce(makeTickets());
    await render(<TicketDetailScreen ticketId="t-up" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("ticket-code", { includeHiddenElements: true })).toBeTruthy();
  });
});
