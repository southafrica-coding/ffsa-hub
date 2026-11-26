// Accessibility checks for the Tickets + door check-in screens: every
// tappable has a role and a name, headers are headers, status is in words,
// and the door speaks its results. See docs/accessibility.md.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";

import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { auditTappables, largeTextProblems } from "@/lib/a11y/testing";

import type { DoorClient } from "../api";
import { ScannerView } from "../components/ScannerView";
import { TicketQr } from "../components/TicketQr";
import { CheckInEventsScreen } from "../screens/CheckInEventsScreen";
import { DoorScreen } from "../screens/DoorScreen";
import { MyTicketsScreen } from "../screens/MyTicketsScreen";
import { TicketDetailScreen } from "../screens/TicketDetailScreen";
import { NOW, makeMe, makeTickets } from "../testing/fixtures";

let mockNet = { isConnected: true, isInternetReachable: true };
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn(), getParent: () => undefined }),
  Stack: { Screen: () => null },
}));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
jest.mock("expo-keep-awake", () => ({ useKeepAwake: jest.fn() }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-brightness", () => ({
  getBrightnessAsync: jest.fn(async () => 0.4),
  setBrightnessAsync: jest.fn(async () => undefined),
  restoreSystemBrightnessAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("react-native-qrcode-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return function QRCode() {
    return <View testID="qr-svg" />;
  };
});
jest.mock("expo-camera", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    useCameraPermissions: () => [mockPermission, jest.fn()],
    CameraView: (props: object) => <View testID="camera" {...props} />,
  };
});
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
}));

const mockFetch = apiFetch as unknown as jest.Mock;
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
const audit = () => auditTappables(screen.container as never);

const EVENTS = {
  events: [{ id: "e1", title: "Send Night", startDate: "2026-11-03", startTime: "18:00:00", endDate: null, endTime: null, location: "Cape Town" }],
};

function api(over: { me?: () => unknown; tickets?: () => unknown; events?: () => unknown } = {}) {
  mockFetch.mockImplementation(async (path: string) => {
    if (path === "/api/me") return (over.me ?? (() => makeMe({ direct: ["events.manage_attendance"] })))();
    if (path === "/api/mobile/my-tickets") return (over.tickets ?? (() => makeTickets()))();
    if (path === "/api/mobile/check-in-events") return (over.events ?? (() => EVENTS))();
    throw new Error(`unexpected ${path}`);
  });
}

function makeDoor(over: Partial<Record<keyof DoorClient, jest.Mock>> = {}) {
  return {
    stats: over.stats ?? jest.fn(async () => ({ checkedIn: 12, total: 40 })),
    search: over.search ?? jest.fn(async () => []),
    checkIn: over.checkIn ?? jest.fn(async () => ({ result: "ok", ticketId: "t1", ticketTypeName: "General", buyerName: "Sample Person 922" })),
    undo: over.undo ?? jest.fn(async () => undefined),
  } as unknown as DoorClient;
}

const now = () => NOW;

beforeEach(async () => {
  mockFetch.mockReset();
  mockNet = { isConnected: true, isInternetReachable: true };
  mockPermission = { granted: true, canAskAgain: true };
  await AsyncStorage.clear();
});

describe("My tickets", () => {
  it("loading: one labelled progress element, nothing unlabelled", async () => {
    api({ tickets: () => new Promise(() => undefined) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(screen.getByRole("progressbar", { name: "Loading your tickets" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "My tickets" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("success: rows are buttons that say title, time, place, holder and status in words", async () => {
    api();
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    const row = await screen.findByRole("button", { name: /^Send Night\..*Ready to scan$/ });
    expect(row.props.accessibilityHint).toBe("Opens the ticket with its QR code");
    expect(screen.getByRole("header", { name: "Coming up, 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run door check-in" })).toBeTruthy();
    const past = screen.getByRole("button", { name: "Show past events (1)" });
    expect(past.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(past);
    expect(screen.getByRole("button", { name: "Hide past events" }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(audit()).toEqual([]);
  });

  it("date box grows with large text instead of clipping", async () => {
    api();
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findByText("Send Night");
    const day = screen.getByText("20", { includeHiddenElements: true });
    const box = day.parent!;
    expect(flat(box.props.style)).toMatchObject({ minWidth: 48 });
    expect(flat(box.props.style).width).toBeUndefined();
  });

  it("empty: the title stays a header", async () => {
    api({ tickets: () => makeTickets({ tickets: [], registrations: [] }) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByRole("header", { name: "No tickets yet" })).toBeTruthy();
  });

  it("error: announced as an alert with a retry button", async () => {
    api({ tickets: () => Promise.reject(new ApiError("http", "Something went wrong.", 500)) });
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("Ticket detail", () => {
  it("the QR is a labelled image that spells the code; the printed code isn't read twice", async () => {
    api();
    await render(<TicketDetailScreen ticketId="t-up" />);
    expect(await screen.findByRole("header", { name: "Send Night" })).toBeTruthy();
    expect(screen.getByRole("image", { name: /^Ticket QR code\. Code A b C d/ })).toBeTruthy();
    expect(screen.queryByTestId("ticket-code")).toBeNull();
    expect(screen.getByText("Ready to scan")).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("a cancelled ticket's QR says it won't scan", async () => {
    await render(<TicketQr code="AbC" dimmed />);
    expect(screen.getByRole("image", { name: /^Cancelled ticket, it won't scan\. Ticket QR code/ })).toBeTruthy();
  });

  it("not found: header, no stray tappables", async () => {
    api();
    await render(<TicketDetailScreen ticketId="nope" />);
    expect(await screen.findByRole("header", { name: "Ticket not found" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("Check-in events", () => {
  it("success: each event is a named button with a hint", async () => {
    api();
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    const row = await screen.findByRole("button", { name: /^Send Night\./ });
    expect(row.props.accessibilityHint).toBe("Opens the door check-in for this event");
    expect(audit()).toEqual([]);
  });

  it("permission denied: says why, as a header", async () => {
    api({ me: () => makeMe() });
    await render(<CheckInEventsScreen />, { wrapper: MeProvider });
    expect(await screen.findByRole("header", { name: "You can't run check-in" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("Door", () => {
  it("tally is one summary; scan, code and search controls are labelled", async () => {
    await render(<DoorScreen eventId="e1" eventTitle="Send Night" door={makeDoor()} />);
    expect(await screen.findByRole("summary", { name: "12 of 40 checked in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan tickets" }).props.accessibilityHint).toMatch(/camera/);
    expect(screen.getByLabelText("Ticket code")).toBeTruthy();
    expect(screen.getByLabelText("Guest name")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Type a code" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Find by name" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("verdict: an alert with words, not just colour, and labelled buttons", async () => {
    await render(<DoorScreen eventId="e1" door={makeDoor()} />);
    await fireEvent.changeText(screen.getByLabelText("Ticket code"), "AbCdEfGhIjK");
    await fireEvent.press(screen.getByRole("button", { name: "Check in" }));
    expect(await screen.findByRole("alert", { name: /Checked in/ })).toBeTruthy();
    expect(screen.getByTestId("verdict").props.accessibilityLiveRegion).toBe("assertive");
    expect(screen.getByRole("button", { name: "Undo" }).props.accessibilityHint).toBe("Reverses this check-in");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("name search announces how many guests it found", async () => {
    const spy = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
    const search = jest.fn(async () => [
      { ticketId: "g1", code: "C1", name: "Sample Person 923", ticketTypeName: "General", status: "valid", checkedInAt: null },
    ]);
    await render(<DoorScreen eventId="e1" door={makeDoor({ search })} />);
    await fireEvent.changeText(screen.getByLabelText("Guest name"), "sample");
    expect(await screen.findByRole("button", { name: "Check in Sample Person 923" })).toBeTruthy();
    expect(spy).toHaveBeenCalledWith("1 guest found", { queue: true });
    expect(audit()).toEqual([]);
    spy.mockRestore();
  });

  it("permission denied", async () => {
    const door = makeDoor({ stats: jest.fn(async () => Promise.reject(new ApiError("forbidden", "no", 403))) });
    await render(<DoorScreen eventId="e1" door={door} />);
    expect(await screen.findByRole("header", { name: "You can't run check-in" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("Scanner", () => {
  const props = { onScanned: jest.fn(), paused: false, onClose: jest.fn(), onTypeCode: jest.fn() };

  it("camera is labelled; close and torch are 48dp+ named buttons with hidden icons", async () => {
    await render(<ScannerView {...props} />);
    // The corner brackets are decoration: nothing for a screen reader to land on.
    expect(screen.queryByTestId("scanner-reticle")).toBeNull();
    expect(screen.getByRole("image", { name: /Camera viewfinder/ })).toBeTruthy();
    for (const name of ["Close scanner", "Turn torch on"]) {
      const btn = screen.getByRole("button", { name });
      expect(flat(btn.props.style).width).toBeGreaterThanOrEqual(48);
      expect(flat(btn.props.style).height).toBeGreaterThanOrEqual(48);
    }
    await fireEvent.press(screen.getByRole("button", { name: "Turn torch on" }));
    expect(screen.getByRole("button", { name: "Turn torch off" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("while the permission loads it says the camera is starting", async () => {
    mockPermission = null;
    await render(<ScannerView {...props} />);
    expect(screen.getByRole("progressbar", { name: "Starting the camera" })).toBeTruthy();
  });

  it("camera refused: a header and the no-camera ways, all labelled", async () => {
    mockPermission = { granted: false, canAskAgain: false };
    await render(<ScannerView {...props} />);
    expect(screen.getByRole("header", { name: "Camera is off for FFSA Hub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Type a code" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

// The largest accessibility text size on a 360pt-wide phone (design-spec §6).
function atLargestText() {
  return jest.spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useWindowDimensions").mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 3.1 });
}

describe("largest text: nothing is capped or clipped", () => {
  it("My tickets", async () => {
    const dims = atLargestText();
    api();
    await render(<MyTicketsScreen now={now} />, { wrapper: MeProvider });
    await screen.findByRole("button", { name: /^Send Night\..*Ready to scan$/ });
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    expect(audit()).toEqual([]);
    dims.mockRestore();
  });

  it("Ticket", async () => {
    const dims = atLargestText();
    api();
    await render(<TicketDetailScreen ticketId="t-up" />);
    expect(await screen.findByRole("header", { name: "Send Night" })).toBeTruthy();
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    expect(audit()).toEqual([]);
    dims.mockRestore();
  });

  it("Door", async () => {
    const dims = atLargestText();
    await render(<DoorScreen eventId="e1" eventTitle="Send Night" door={makeDoor()} />);
    expect(await screen.findByRole("summary", { name: "12 of 40 checked in" })).toBeTruthy();
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    expect(audit()).toEqual([]);
    dims.mockRestore();
  });
});
