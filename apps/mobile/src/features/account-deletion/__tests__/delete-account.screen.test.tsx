import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { apiRoutes } from "../../../../test/fixtures";

import { DeleteAccountScreen } from "../DeleteAccountScreen";
import { strings as s } from "../strings";

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

const mockFetch = apiFetch as unknown as jest.Mock;
const PATH = "/api/account/deletion-request";
const OPEN = { id: "r1", status: "open", reason: null, requestedAt: "2026-11-03T10:00:00Z" };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function Wrapper({ children }: { children: ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

type Init = { method?: string; body?: unknown };

/** Answer GET / POST / DELETE on the deletion route. */
function server(h: { get?: unknown; post?: unknown; del?: unknown }) {
  mockFetch.mockImplementation(
    apiRoutes({
      [PATH]: (init?: Init) => {
        const m = init?.method ?? "GET";
        const v = m === "POST" ? h.post : m === "DELETE" ? h.del : h.get;
        return typeof v === "function" ? (v as (i?: Init) => unknown)(init) : v;
      },
    }),
  );
}

const calls = (method: string) =>
  mockFetch.mock.calls.filter((c) => (c[1]?.method ?? "GET") === method && c[0] === PATH);

async function show() {
  await render(<DeleteAccountScreen />, { wrapper: Wrapper });
}

async function requestAndConfirm() {
  await fireEvent.press(await screen.findByTestId("deletion-request"));
  await fireEvent.press(await screen.findByTestId("deletion-confirm"));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DeleteAccountScreen", () => {
  it("loading: a skeleton while it checks", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    await show();
    expect(screen.getByLabelText(s.loading)).toBeTruthy();
    // The explanation is there straight away.
    expect(screen.getByText(s.keepItems[0])).toBeTruthy();
    expect(screen.getByText(s.staysActive)).toBeTruthy();
  });

  it("none: what happens, what's kept, an optional reason and the request button", async () => {
    server({ get: { request: null, contactEmail: "office@ffsa.test" } });
    await show();
    expect(await screen.findByTestId("deletion-none")).toBeTruthy();
    expect(screen.getByText(s.intro)).toBeTruthy();
    expect(screen.getByText(s.deleteItems[0])).toBeTruthy();
    expect(screen.getByLabelText(s.reason.label)).toBeTruthy();
    const button = screen.getByRole("button", { name: s.request.button });
    expect(button.props.accessibilityHint).toBe(s.request.hint);
  });

  it("is a pushed screen named 'Delete account', and the reason stops at 1000 characters", async () => {
    server({ get: { request: null } });
    await show();
    expect(screen.getByRole("header", { name: s.title })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Me" })).toBeTruthy();
    for (const heading of [s.deleteHeading, s.keepHeading, s.requestHeading]) {
      expect(screen.getByRole("header", { name: heading })).toBeTruthy();
    }
    const reason = await screen.findByTestId("deletion-reason");
    expect(reason.props.maxLength).toBe(1000);
    expect(screen.getByText(s.reason.hint)).toBeTruthy();
  });

  it("the confirm sheet says what happens, with the two answers", async () => {
    server({ get: { request: null } });
    await show();
    await fireEvent.press(await screen.findByTestId("deletion-request"));
    expect(await screen.findByText(s.confirm.body)).toBeTruthy();
    expect(screen.getByRole("button", { name: s.confirm.yes }).props.accessibilityHint).toBe(s.confirm.yesHint);
    expect(screen.getByRole("button", { name: s.confirm.no })).toBeTruthy();
  });

  it("requested: a 'Request sent' chip (a word, not colour alone); the form is gone but the explanation stays", async () => {
    server({ get: { request: OPEN } });
    await show();
    expect(await screen.findByLabelText(s.requested.title)).toBeTruthy();
    expect(screen.getByText(s.staysActive)).toBeTruthy();
    expect(screen.getByText(s.keepItems[0])).toBeTruthy();
    expect(screen.queryByRole("header", { name: s.requestHeading })).toBeNull();
    expect(screen.getByTestId("deletion-web")).toBeTruthy();
  });

  it("cancel confirm sheet: 'Keep your account?' with Go back sending nothing", async () => {
    server({ get: { request: OPEN }, del: { request: null, cancelled: true } });
    await show();
    await fireEvent.press(await screen.findByTestId("deletion-cancel"));
    expect(await screen.findByText(s.cancelConfirm.title)).toBeTruthy();
    expect(screen.getByText(s.cancelConfirm.body)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: s.cancelConfirm.no }));
    await waitFor(() => expect(screen.queryByTestId("deletion-cancel-confirm")).toBeNull());
    expect(calls("DELETE")).toHaveLength(0);
    expect(screen.getByTestId("deletion-requested")).toBeTruthy();
  });

  it("two steps: the first tap only opens the confirm sheet; Go back sends nothing", async () => {
    server({ get: { request: null } });
    await show();
    await fireEvent.press(await screen.findByTestId("deletion-request"));
    expect(await screen.findByText(s.confirm.title)).toBeTruthy();
    expect(calls("POST")).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: s.confirm.no }));
    await waitFor(() => expect(screen.queryByTestId("deletion-confirm")).toBeNull());
    expect(calls("POST")).toHaveLength(0);
  });

  it("success: sends the reason, shows 'Requested on <date>' and the cancel action", async () => {
    server({ get: { request: null }, post: { request: { ...OPEN, reason: "Moving on" }, recorded: true } });
    await show();
    await fireEvent.changeText(await screen.findByTestId("deletion-reason"), "  Moving on ");
    await requestAndConfirm();
    expect(await screen.findByTestId("deletion-requested")).toBeTruthy();
    expect(screen.getByText("Requested on 3 November 2026. We'll email you when it's done.")).toBeTruthy();
    expect(screen.getByText(s.requested.sentNow)).toBeTruthy();
    expect(screen.queryByText(s.requested.emailedOnly)).toBeNull();
    expect(calls("POST")[0][1].body).toEqual({ confirm: true, reason: "Moving on", source: "app" });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    expect(screen.getByRole("button", { name: s.requested.cancel })).toBeTruthy();
  });

  it("202 recorded:false still shows success (a person has it by email)", async () => {
    server({ get: { request: null }, post: { request: { ...OPEN, id: null }, recorded: false, notified: true } });
    await show();
    await requestAndConfirm();
    expect(await screen.findByTestId("deletion-requested")).toBeTruthy();
    expect(screen.getByText(s.requested.emailedOnly)).toBeTruthy();
  });

  it("requested on revisit: GET finds the open request", async () => {
    server({ get: { request: OPEN } });
    await show();
    expect(await screen.findByTestId("deletion-requested")).toBeTruthy();
    expect(screen.getByText("Requested on 3 November 2026. We'll email you when it's done.")).toBeTruthy();
    expect(screen.queryByText(s.requested.sentNow)).toBeNull();
    expect(screen.queryByTestId("deletion-request")).toBeNull();
  });

  it("cancel: confirm sheet, DELETE, back to the form", async () => {
    server({ get: { request: OPEN }, del: { request: null, cancelled: true } });
    await show();
    await fireEvent.press(await screen.findByTestId("deletion-cancel"));
    expect(calls("DELETE")).toHaveLength(0);
    await fireEvent.press(await screen.findByTestId("deletion-cancel-confirm"));
    expect(await screen.findByTestId("deletion-none")).toBeTruthy();
    expect(calls("DELETE")).toHaveLength(1);
  });

  it("cancel 409 (Hub can't cancel yet): keeps the request and says who to email", async () => {
    server({
      get: { request: OPEN, contactEmail: "office@ffsa.test" },
      del: new ApiError("http", "x", 409),
    });
    await show();
    await fireEvent.press(await screen.findByTestId("deletion-cancel"));
    await fireEvent.press(await screen.findByTestId("deletion-cancel-confirm"));
    expect(await screen.findByText(s.errors.cannotCancel("office@ffsa.test"))).toBeTruthy();
    expect(screen.getByTestId("deletion-requested")).toBeTruthy();
  });

  it("error loading: plain message and a retry that works", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError("http", "x", 500));
    await show();
    expect(await screen.findByText(s.loadErrorTitle)).toBeTruthy();
    expect(screen.getByText(s.errors.generic("info@fireandfragrance.com"))).toBeTruthy();
    server({ get: { request: null } });
    await fireEvent.press(screen.getByRole("button", { name: s.retry }));
    expect(await screen.findByTestId("deletion-none")).toBeTruthy();
  });

  it("offline while sending: says so, with the contact address, and keeps the reason", async () => {
    server({ get: { request: null, contactEmail: "office@ffsa.test" }, post: new ApiError("network", "x") });
    await show();
    await fireEvent.changeText(await screen.findByTestId("deletion-reason"), "Leaving");
    await requestAndConfirm();
    expect(await screen.findByText(s.errors.offline("office@ffsa.test"))).toBeTruthy();
    expect(screen.getByText(s.errorTitle)).toBeTruthy();
    expect(screen.getByTestId("deletion-reason").props.value).toBe("Leaving");
    expect(screen.getByTestId("deletion-none")).toBeTruthy();
  });

  it("503: nothing could be sent, so it tells the person who to email", async () => {
    server({ get: { request: null, contactEmail: "office@ffsa.test" }, post: new ApiError("http", "x", 503) });
    await show();
    await requestAndConfirm();
    expect(await screen.findByText(s.errors.unavailable("office@ffsa.test"))).toBeTruthy();
    expect(screen.queryByTestId("deletion-requested")).toBeNull();
  });

  it("permission denied: a plain message, no crash", async () => {
    mockFetch.mockRejectedValue(new ApiError("forbidden", "You don't have access to this.", 403));
    await show();
    expect(await screen.findByText(s.errors.forbidden("info@fireandfragrance.com"))).toBeTruthy();
  });

  it("signed out by the server: shows nothing extra (the app returns to sign-in)", async () => {
    mockFetch.mockRejectedValue(new ApiError("unauthenticated", "x", 401));
    await show();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("deletion-load-error")).toBeNull();
  });

  it("the website fallback opens the public page", async () => {
    server({ get: { request: null } });
    await show();
    await fireEvent.press(await screen.findByTestId("deletion-web"));
    expect((WebBrowser.openBrowserAsync as jest.Mock).mock.calls[0][0]).toMatch(/\/legal\/delete-account$/);
  });
});
