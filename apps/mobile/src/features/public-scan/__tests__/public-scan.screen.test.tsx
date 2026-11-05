import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { Linking } from "react-native";

import { queueKey } from "@/features/tickets/offline-queue";
import { auditTappables } from "@/lib/a11y/testing";
import { apiFetch } from "@/lib/api-client";

import { createPublicFetch, doorKey } from "../api";
import { PublicScanScreen } from "../screens/PublicScanScreen";
import { SCANNER_NAME_KEY } from "../scanner-name";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";
const DOOR = `/api/scan/${TOKEN}`;
const DEAD = "This scanning link is no longer active. Ask the event organiser for a current one.";

let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
const mockCamera: { props: { onBarcodeScanned?: (r: { data: string; type: string }) => void } | null } = { props: null };
const mockRouter = { canGoBack: jest.fn(() => false), replace: jest.fn() };
const mockHeaders: Record<string, unknown>[] = [];

jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options?: Record<string, unknown> }) => {
      if (options) mockHeaders.push(options);
      return null;
    },
  },
  useRouter: () => mockRouter,
}));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("expo-keep-awake", () => ({ useKeepAwake: jest.fn() }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("expo-camera", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    useCameraPermissions: () => [mockPermission, jest.fn()],
    CameraView: (props: object) => {
      mockCamera.props = props;
      return <View testID="camera" />;
    },
  };
});
// A signed-in staff member opening a volunteer link: the Hub session exists,
// but the door must never use it.
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "staff-1" }, access_token: "staff-token" } } }) } },
}));

// ── A fake /api/scan/[token] behind the real session-free fetch ─────────────

type Handler = (body: Record<string, unknown> | null) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const offline = () => Promise.reject(new TypeError("Network request failed"));

let routes: Record<string, Handler>;
const calls: { method: string; path: string; body: Record<string, unknown> | null; auth: string | null }[] = [];

function serve(over: Partial<Record<string, Handler>> = {}) {
  routes = {
    [`GET ${DOOR}?stats=1`]: () => json({ checkedIn: 12, total: 40 }),
    [`GET ${DOOR}/event`]: () => json({ event: { title: "Send Night", startDate: "2026-11-07" } }),
    [`POST ${DOOR}`]: (body) =>
      body?.undo ? json({ result: "undone" }) : json({ result: "ok", ticketId: "t1", ticketTypeName: "General", buyerName: "Sarah Mokoena" }),
    ...over,
  } as Record<string, Handler>;
}

const fetcher = createPublicFetch({
  baseUrl: "https://hub.test",
  fetchImpl: (async (url: string, init: RequestInit) => {
    const path = url.replace("https://hub.test", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body, auth: (init.headers as Headers).get("Authorization") });
    const key = path.includes("?q=") ? `GET ${DOOR}?q` : `${method} ${path}`;
    const handler = routes[key];
    if (!handler) return json({ error: "not found" }, 404);
    return handler(body);
  }) as unknown as typeof fetch,
});

const screenFor = (token: unknown = TOKEN): ReactElement => <PublicScanScreen token={token} fetcher={fetcher} />;
const checkIns = () => calls.filter((c) => c.method === "POST" && !c.body?.undo);

async function typeCode(code: string) {
  await fireEvent.changeText(screen.getByLabelText("Ticket code"), code);
  await fireEvent.press(screen.getByRole("button", { name: "Check in" }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockPermission = { granted: true, canAskAgain: true };
  mockCamera.props = null;
  mockHeaders.length = 0;
  calls.length = 0;
  mockRouter.canGoBack.mockReturnValue(false);
  serve();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(SCANNER_NAME_KEY, "Thandi");
});

describe("Volunteer door: opening the link", () => {
  it("loading: a labelled progress placeholder while the link is checked", async () => {
    serve({ [`GET ${DOOR}?stats=1`]: () => new Promise(() => {}) });
    await render(screenFor());
    expect(screen.getByRole("progressbar", { name: "Opening the door scanner" })).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("a malformed link never reaches the server", async () => {
    await render(screenFor("not-a-link"));
    expect(screen.getByText("This scanning link isn't active")).toBeTruthy();
    expect(screen.getByText(/doesn't look like a complete scanning link/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("dead link (404): calm words, Try again, and Open on the website", async () => {
    serve({ [`GET ${DOOR}?stats=1`]: () => json({ error: DEAD }, 404), [`GET ${DOOR}/event`]: () => json({ error: DEAD }, 404) });
    await render(screenFor());
    expect(await screen.findByText("This scanning link isn't active")).toBeTruthy();
    expect(screen.getByText(/replaced, switched off, or the event has passed/)).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Open on the website" }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(`https://hub.example.test/scan/${TOKEN}`, expect.anything());

    serve();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("12 of 40 checked in")).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("offline on open: says so with a next step, and retries", async () => {
    serve({ [`GET ${DOOR}?stats=1`]: offline, [`GET ${DOOR}/event`]: offline });
    await render(screenFor());
    expect(await screen.findByTestId("error-state")).toHaveTextContent(/You're offline\. Connect to Wi-Fi or mobile data/);
    expect(screen.getByRole("button", { name: "Open on the website" })).toBeTruthy();
    serve();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("12 of 40 checked in")).toBeTruthy();
  });

  it("too many requests (429): asks them to wait", async () => {
    serve({ [`GET ${DOOR}?stats=1`]: () => json({ error: "Too many requests. Wait a moment and try again." }, 429) });
    await render(screenFor());
    expect(await screen.findByTestId("error-state")).toHaveTextContent(/Wait a moment, then try again/);
  });

  it("still opens if only the event title can't be read (older server)", async () => {
    serve({ [`GET ${DOOR}/event`]: () => json({ error: "not found" }, 404) });
    await render(screenFor());
    expect(await screen.findByLabelText("12 of 40 checked in")).toBeTruthy();
    expect(screen.getAllByText("Door scanner").length).toBeGreaterThan(0);
  });

  it("opened from a link with nothing behind it: Done goes Home (or sign-in)", async () => {
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    const withDone = mockHeaders.find((o) => typeof o.headerLeft === "function");
    expect(withDone?.title).toBe("Door scanner");
    await render((withDone!.headerLeft as () => ReactElement)());
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });
});

describe("Volunteer door: who is scanning", () => {
  it("asks for a first name once, then opens the door and remembers it", async () => {
    await AsyncStorage.removeItem(SCANNER_NAME_KEY);
    await render(screenFor());
    expect(await screen.findByRole("header", { name: "Who's on the door?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start scanning" })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("First name"), "  Lerato ");
    await fireEvent.press(screen.getByRole("button", { name: "Start scanning" }));
    expect(await screen.findByText("Scanning as Lerato")).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem(SCANNER_NAME_KEY)).toBe("Lerato"));
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("Not you? forgets the name and asks again", async () => {
    await render(screenFor());
    await fireEvent.press(await screen.findByRole("button", { name: "Not you?" }));
    expect(await screen.findByRole("header", { name: "Who's on the door?" })).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem(SCANNER_NAME_KEY)).toBeNull());
  });
});

describe("Volunteer door: scanning", () => {
  it("success: the event title and tally show; check-in sends the name with no session; Undo reverses it", async () => {
    await render(screenFor());
    expect(await screen.findByLabelText("12 of 40 checked in")).toBeTruthy();
    expect(screen.getByText("Send Night")).toBeTruthy();
    expect(useKeepAwake).toHaveBeenCalled();

    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Checked in");
    expect(screen.getByText("Sarah Mokoena · General")).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    expect(checkIns()[0].body).toEqual({ code: "AbCdEfGhIjK", scannerName: "Thandi" });

    await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Check-in undone")).toBeTruthy();
    expect(calls.find((c) => c.body?.undo)?.body).toEqual({ undo: "t1" });

    // The link is the authority: the signed-in person's session is never used.
    expect(apiFetch).not.toHaveBeenCalled();
    expect(calls.every((c) => c.auth === null)).toBe(true);
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("already checked in: says so with the time, no Undo", async () => {
    serve({
      [`POST ${DOOR}`]: () => json({ result: "already_checked_in", ticketTypeName: "General", checkedInAt: "2026-11-07T16:05:00.000Z" }),
    });
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent(/^Already checked in at \d\d:\d\d$/);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("the link dies mid-event: the scan shows the server's words, not a check-in", async () => {
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    serve({ [`POST ${DOOR}`]: () => json({ error: DEAD }, 404) });
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Needs attention");
    expect(screen.getByText(DEAD)).toBeTruthy();
  });

  it("signal drops: the scan is saved as NOT confirmed, under the link (never the token or the account)", async () => {
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    serve({ [`POST ${DOOR}`]: offline });
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Saved, not yet confirmed");
    expect(screen.getByTestId("queue-banner")).toHaveTextContent(/1 scan not yet confirmed/);

    await waitFor(async () => expect(await AsyncStorage.getItem(queueKey(doorKey(TOKEN)))).toContain("AbCdEfGhIjK"));
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some((k) => k.includes(TOKEN))).toBe(false);
    expect(keys.some((k) => k.includes("staff-1"))).toBe(false);

    // Back online: Send now delivers it under the same link.
    serve();
    await fireEvent.press(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(screen.queryByTestId("queue-banner")).toBeNull());
    expect(checkIns().at(-1)?.body).toEqual({ code: "AbCdEfGhIjK", scannerName: "Thandi" });
  });

  it("camera: one ticket in front of the lens is sent once (the Tickets scan gate)", async () => {
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    await fireEvent.press(screen.getByRole("button", { name: "Scan tickets" }));
    await act(async () => {
      mockCamera.props!.onBarcodeScanned!({ data: "AbCdEfGhIjK", type: "qr" });
    });
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Checked in");
    await fireEvent.press(screen.getByRole("button", { name: "Scan next" }));
    await act(async () => {
      mockCamera.props!.onBarcodeScanned!({ data: "AbCdEfGhIjK", type: "qr" });
    });
    expect(checkIns()).toHaveLength(1);
  });

  it("camera refused: Settings, plus typing the code still works", async () => {
    mockPermission = { granted: false, canAskAgain: false };
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValueOnce(undefined);
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    await fireEvent.press(screen.getByRole("button", { name: "Scan tickets" }));
    expect(screen.getByText("Camera is off for FFSA Hub")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(openSettings).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Close scanner" }));
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Checked in");
  });

  it("name search works on the public link", async () => {
    routes[`GET ${DOOR}?q`] = () =>
      json({ guests: [{ ticketId: "t9", code: "QwErTyUiOpA", name: "Sarah Mokoena", ticketTypeName: "General", status: "valid", checkedInAt: null }] });
    await render(screenFor());
    await screen.findByLabelText("12 of 40 checked in");
    await fireEvent.changeText(screen.getByLabelText("Guest name"), "sarah");
    await fireEvent.press(await screen.findByRole("button", { name: "Check in Sarah Mokoena" }));
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Checked in");
    expect(checkIns()[0].body).toEqual({ code: "QwErTyUiOpA", scannerName: "Thandi" });
  });
});
