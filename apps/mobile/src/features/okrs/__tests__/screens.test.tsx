import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";
import { announce } from "@/lib/a11y";

import { CURRENT, OWNER_ID, PAST, checkin, keyResult, objective, owner, ownerPage, wall } from "../__fixtures__/fixtures";
import { okrsApi } from "../client";
import OwnerScreen from "../screens/OwnerScreen";
import WallScreen from "../screens/WallScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Error: "error", Warning: "warning" },
}));
jest.mock("@/lib/a11y", () => ({ ...jest.requireActual("@/lib/a11y"), announce: jest.fn() }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../client", () => ({
  okrsApi: { loadWall: jest.fn(), loadOwner: jest.fn(), loadCheckins: jest.fn(), postCheckin: jest.fn() },
}));

const api = okrsApi as unknown as Record<"loadWall" | "loadOwner" | "loadCheckins" | "postCheckin", jest.Mock>;
const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock; writeCache: jest.Mock };
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.loadCheckins.mockResolvedValue([]);
  cache.readCache.mockReset().mockResolvedValue(null);
  cache.writeCache.mockClear();
  openBrowser.mockReset();
  (announce as jest.Mock).mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  Object.values(mockRouter).forEach((f) => f.mockReset());
});

// ── The wall ────────────────────────────────────────────────────────────────

describe("OKR wall", () => {
  it("loading: a skeleton with a spoken label", async () => {
    api.loadWall.mockReturnValue(new Promise(() => undefined));
    await show(<WallScreen cycle={null} />);
    expect(screen.getByLabelText(strings.wall.loading)).toBeTruthy();
  });

  it("empty: no cycle opened yet", async () => {
    api.loadWall.mockResolvedValue(wall({ cycles: [], cycle: null, sections: [], showHeadings: false }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText(strings.wall.noCycleTitle)).toBeTruthy();
    expect(screen.queryByTestId("cycle-switcher")).toBeNull();
  });

  it("empty: a cycle with nothing entered yet", async () => {
    api.loadWall.mockResolvedValue(wall({ sections: [], showHeadings: false, totals: { groups: 4, groupsStarted: 0, objectives: 0, keyResults: 0, complete: 0, stuck: 0 } }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText(strings.wall.nothingYet("2026"))).toBeTruthy();
  });

  it("error: the message and a retry that loads again", async () => {
    api.loadWall.mockRejectedValueOnce(new ApiError("network", "x")).mockResolvedValue(wall());
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Choir")).toBeTruthy();
  });

  it("permission denied: says it isn't available on this account", async () => {
    api.loadWall.mockRejectedValue(new ApiError("forbidden", "x", 403));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("success: KPIs in words, Main / Part-time sections, status tags; opens a group; saved for offline", async () => {
    api.loadWall.mockResolvedValue(wall());
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText("DTS")).toBeTruthy();
    expect(api.loadWall).toHaveBeenCalledWith(null);
    expect(screen.getByLabelText("Groups started, 2, of 3")).toBeTruthy();
    expect(screen.getByLabelText(`Stuck, 1, ${strings.wall.kpiStuckSome}`)).toBeTruthy();
    expect(screen.getByLabelText(`Main ministries, ${strings.wall.sectionMeta(1, 2)}`)).toBeTruthy();
    expect(screen.getByLabelText(`Part-time ministries, ${strings.wall.sectionMeta(1, 1)}`)).toBeTruthy();
    expect(screen.getByText("1 Stuck")).toBeTruthy();
    expect(screen.getByText("2 Complete")).toBeTruthy();
    // Not a leader: no gap list, no cycles link, no yellow band.
    expect(screen.queryByText(strings.wall.notStarted)).toBeNull();
    expect(screen.queryByTestId("manage-cycles")).toBeNull();
    expect(screen.queryByTestId("needs-you")).toBeNull();

    await fireEvent.press(screen.getByTestId(`owner-${OWNER_ID}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/okrs/[ownerId]", params: { ownerId: OWNER_ID, cycle: "2026" } });
    expect(cache.writeCache).toHaveBeenCalledWith("user-1", "okrs.wall.current", expect.anything());
  });

  it("header and figures: the cycle in the eyebrow, the intro, a real bar for key results, back to Home", async () => {
    api.loadWall.mockResolvedValue(wall());
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText("Strategy · 2026")).toBeTruthy();
    expect(screen.getByText(strings.wall.intro("2026"))).toBeTruthy();
    expect(screen.getByLabelText("Objectives, 3")).toBeTruthy();
    expect(screen.getByLabelText("Key results, 6, 2 complete")).toBeTruthy();
    // Everyone gets the website link; only those allowed get the cycles one.
    await fireEvent.press(screen.getByTestId("open-web"));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/okrs?cycle=2026", expect.anything());
    await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
  });

  it("nothing stuck: the figure says so calmly", async () => {
    api.loadWall.mockResolvedValue(wall({ totals: { groups: 3, groupsStarted: 2, objectives: 3, keyResults: 6, complete: 2, stuck: 0 } }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByLabelText(`Stuck, 0, ${strings.wall.kpiStuckNone}`)).toBeTruthy();
  });

  it("one cycle: the cycle is plain text, with nothing to open", async () => {
    api.loadWall.mockResolvedValue(wall({ cycles: [CURRENT] }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByLabelText("Cycle: 2026 (current). 1 Jan 2026 to 31 Dec 2026")).toBeTruthy();
    expect(screen.queryByTestId("cycle-switcher")).toBeNull();
  });

  it("a retired group says so in words", async () => {
    api.loadWall.mockResolvedValue(wall({ showHeadings: false, sections: [{ ...wall().sections[0], started: [owner({ retired: true })] }] }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText(strings.wall.retired)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^DTS\. Retired\. 2 objectives · 5 key results/ })).toBeTruthy();
    // One kind of ministry: a plain "Groups" heading with its count.
    expect(screen.getByLabelText("Groups, 1")).toBeTruthy();
  });

  it("one kind of ministry: no section headings", async () => {
    api.loadWall.mockResolvedValue(wall({ showHeadings: false, sections: [wall().sections[0]] }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByText("DTS")).toBeTruthy();
    expect(screen.queryByText("Main ministries")).toBeNull();
  });

  it("leaders and leadership: the not-started list, and the cycles page on the website", async () => {
    const quiet = owner({ id: "m-worship", name: "Worship", objectives: 0, keyResults: 0, byStatus: { not_started: 0, in_progress: 0, moving_forward: 0, stuck: 0, complete: 0 } });
    api.loadWall.mockResolvedValue(
      wall({ seesGaps: true, canManageCycles: true, sections: [{ ...wall().sections[0], notStarted: [quiet] }, wall().sections[1]] }),
    );
    await show(<WallScreen cycle={null} />);
    const gaps = await screen.findByTestId("not-started-main");
    expect(within(gaps).getByText("Worship")).toBeTruthy();
    expect(within(gaps).getByText(strings.wall.noOkrsYet)).toBeTruthy();
    // "Not started yet" sits inside its section, and its rows still open the group.
    expect(within(screen.getByTestId("section-main")).getByLabelText(`${strings.wall.notStarted}, 1`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("owner-m-worship"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/okrs/[ownerId]", params: { ownerId: "m-worship", cycle: "2026" } });
    await fireEvent.press(screen.getByTestId("manage-cycles"));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/okrs/cycles", expect.anything());
  });

  it("switching cycle sets the route's cycle", async () => {
    api.loadWall.mockResolvedValue(wall());
    await show(<WallScreen cycle={null} />);
    await fireEvent.press(await screen.findByTestId("cycle-switcher"));
    await fireEvent.press(screen.getByRole("radio", { name: "2025" }));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ cycle: "2025" });
  });

  it("offline: shows the saved copy and says when it was saved", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: wall() });
    api.loadWall.mockRejectedValue(new ApiError("network", "x"));
    await show(<WallScreen cycle="2026" />);
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(screen.getByText("DTS")).toBeTruthy();
    expect(cache.readCache).toHaveBeenCalledWith("user-1", "okrs.wall.2026");
    // Calm, with a way forward (frame 13.3).
    expect(screen.getByText(strings.common.checkinsNeedSignal)).toBeTruthy();
    api.loadWall.mockResolvedValue(wall());
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(strings.common.refreshFailed("09:05"))).toBeNull());
  });
});

// ── One group ───────────────────────────────────────────────────────────────

describe("OKR owner page", () => {
  it("loading: a skeleton with a spoken label", async () => {
    api.loadOwner.mockReturnValue(new Promise(() => undefined));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(screen.getByLabelText(strings.owner.loading)).toBeTruthy();
  });

  it("not found: says so, with a way back to all groups", async () => {
    api.loadOwner.mockRejectedValue(new ApiError("http", "x", 404));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.owner.notFoundTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.allGroups }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/okrs");
  });

  it("error: the message and a retry", async () => {
    api.loadOwner.mockRejectedValueOnce(new ApiError("http", "x", 500)).mockResolvedValue(ownerPage());
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.common.generic)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText(`1. Grow the school, ${strings.owner.keyResultsMeta(2)}`)).toBeTruthy();
  });

  it("permission denied: says it isn't available", async () => {
    api.loadOwner.mockRejectedValue(new ApiError("forbidden", "x", 403));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("empty: no objectives this cycle", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ objectives: [], totals: { objectives: 0, keyResults: 0, complete: 0, stuck: 0 } }));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.owner.emptyReadOnly)).toBeTruthy();
  });

  it("read access: calm note, a bar only where there's a ratio, no check-in form", async () => {
    api.loadOwner.mockResolvedValue(ownerPage());
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.owner.readAccess)).toBeTruthy();
    expect(screen.getByLabelText(`1. Grow the school, ${strings.owner.keyResultsMeta(2)}`)).toBeTruthy();
    expect(screen.getByTestId("kr-bar-kr1", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("kr-bar-kr2", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText("90 / 180 people")).toBeTruthy();
    expect(screen.queryByTestId("edit-on-web")).toBeNull();
    expect(screen.getByText("OKRs · 2026")).toBeTruthy();
    expect(screen.getByLabelText("Stuck, 1")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to OKRs" }));
    expect(mockRouter.back).toHaveBeenCalled();

    api.loadCheckins.mockResolvedValue([checkin()]);
    await fireEvent.press(screen.getByTestId("kr-kr1"));
    expect(await screen.findByText("Halfway there")).toBeTruthy();
    expect(screen.getByText(strings.kr.readOnly)).toBeTruthy();
    expect(screen.queryByTestId("checkin-form")).toBeNull();
  });

  it("closed cycle: read-only, even for a leader", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ cycle: PAST, canEdit: false, readOnly: "closed" }));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle="2025" />);
    expect(await screen.findByText(strings.owner.closed)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("kr-kr1"));
    expect(await screen.findByText(strings.kr.closed)).toBeTruthy();
    expect(api.loadOwner).toHaveBeenCalledWith(OWNER_ID, "2025");
  });

  it("leader: checks in from the sheet; the figure, status and comment are sent, then the page refreshes", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ canEdit: true, readOnly: null }));
    api.postCheckin.mockResolvedValue(undefined);
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.owner.canEdit)).toBeTruthy();
    expect(screen.getByTestId("edit-on-web")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("kr-kr1"));
    expect(await screen.findByTestId("history-empty")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Complete" }));
    await fireEvent.changeText(screen.getByTestId("checkin-value"), "180");
    await fireEvent.changeText(screen.getByTestId("checkin-comment"), "Done!");
    await fireEvent.press(screen.getByTestId("checkin-save"));

    await waitFor(() => expect(api.postCheckin).toHaveBeenCalledWith("kr1", { status: "complete", value: 180, comment: "Done!" }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith(strings.kr.saved));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    await waitFor(() => expect(api.loadOwner).toHaveBeenCalledTimes(2));
    expect(api.loadCheckins).toHaveBeenCalledTimes(2);
  });

  it("leader: a figure that isn't a number is caught before sending", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ canEdit: true, readOnly: null }));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    await fireEvent.press(await screen.findByTestId("kr-kr1"));
    await fireEvent.changeText(await screen.findByTestId("checkin-value"), "lots");
    await fireEvent.press(screen.getByTestId("checkin-save"));
    expect(await screen.findByText(strings.errors.valueNotNumber)).toBeTruthy();
    // Said on the figure's own field, and cleared as soon as it's corrected.
    expect(screen.getByTestId("checkin-value").props.accessibilityHint).toBe(strings.errors.valueNotNumber);
    expect(api.postCheckin).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("checkin-value"), "12,5");
    expect(screen.queryByText(strings.errors.valueNotNumber)).toBeNull();
  });

  it("leader offline: the saved copy, and a note that check-ins need a signal", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: ownerPage({ canEdit: true, readOnly: null }) });
    api.loadOwner.mockRejectedValue(new ApiError("network", "x"));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(screen.getByText(strings.common.checkinsNeedSignal)).toBeTruthy();
    expect(screen.getByText(strings.owner.canEdit)).toBeTruthy();
  });

  it("member offline: the saved copy without the check-in note", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: ownerPage() });
    api.loadOwner.mockRejectedValue(new ApiError("network", "x"));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(screen.queryByText(strings.common.checkinsNeedSignal)).toBeNull();
  });

  it("leader: a prose key result has no figure field", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ canEdit: true, readOnly: null }));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    await fireEvent.press(await screen.findByTestId("kr-kr2"));
    expect(await screen.findByTestId("checkin-form")).toBeTruthy();
    expect(screen.queryByTestId("checkin-value")).toBeNull();
  });

  it("the server refuses: says why and keeps what was typed", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ canEdit: true, readOnly: null }));
    api.postCheckin.mockRejectedValue(new ApiError("forbidden", "x", 403));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    await fireEvent.press(await screen.findByTestId("kr-kr2"));
    await fireEvent.changeText(await screen.findByTestId("checkin-comment"), "Blocked on visas");
    await fireEvent.press(screen.getByTestId("checkin-save"));
    expect(await screen.findByText(strings.errors.saveForbidden)).toBeTruthy();
    expect(screen.getByTestId("checkin-comment").props.value).toBe("Blocked on visas");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
  });

  it("history that fails to load has its own retry", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ objectives: [objective({ keyResults: [keyResult({ notes: "Context here" })] })] }));
    api.loadCheckins.mockRejectedValueOnce(new ApiError("network", "x")).mockResolvedValue([checkin({ comment: "Back on track" })]);
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    await fireEvent.press(await screen.findByTestId("kr-kr1"));
    expect(await screen.findByText(strings.kr.historyError)).toBeTruthy();
    expect(screen.getByText("Context here")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("history-retry"));
    expect(await screen.findByText("Back on track")).toBeTruthy();
  });
});
