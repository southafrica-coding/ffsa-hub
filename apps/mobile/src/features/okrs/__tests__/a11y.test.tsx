// Accessibility checks for the OKR wall, a group's page and the key-result
// sheet: every tappable has a role and a name, headings are headers, status
// is in words, the cycle picker is a radio group, and progress bars are
// described in words rather than left to colour.

import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";
import { auditTappables } from "@/lib/a11y/testing";

import { OWNER_ID, checkin, ownerPage, wall } from "../__fixtures__/fixtures";
import { okrsApi } from "../client";
import OwnerScreen from "../screens/OwnerScreen";
import WallScreen from "../screens/WallScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(async () => undefined), NotificationFeedbackType: { Success: "s", Error: "e" } }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../client", () => ({
  okrsApi: { loadWall: jest.fn(), loadOwner: jest.fn(), loadCheckins: jest.fn(), postCheckin: jest.fn() },
}));

const api = okrsApi as unknown as Record<"loadWall" | "loadOwner" | "loadCheckins" | "postCheckin", jest.Mock>;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const audit = () => auditTappables(screen.container as never);

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.loadCheckins.mockResolvedValue([checkin()]);
});

describe("OKR wall", () => {
  it("loading and error: labelled progress, retry is a named button", async () => {
    api.loadWall.mockReturnValue(new Promise(() => undefined));
    await show(<WallScreen cycle={null} />);
    expect(screen.getByRole("progressbar", { name: strings.wall.loading })).toBeTruthy();
    expect(audit()).toEqual([]);
    await screen.unmount();

    api.loadWall.mockRejectedValue(new ApiError("forbidden", "x", 403));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("empty: the title is a header", async () => {
    api.loadWall.mockResolvedValue(wall({ cycles: [], cycle: null, sections: [] }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByRole("header", { name: strings.wall.noCycleTitle })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("success: section headers, group rows say name + counts + status words, cycle picker is a radio group", async () => {
    api.loadWall.mockResolvedValue(wall({ canManageCycles: true }));
    await show(<WallScreen cycle={null} />);
    expect(await screen.findByRole("header", { name: /Main ministries/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^DTS\. 2 objectives · 5 key results\. 2 In progress\. 1 Stuck\. 2 Complete$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(strings.cycle.manage) })).toBeTruthy();
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByRole("button", { name: strings.cycle.switchA11y("2026 (current)") }));
    expect(screen.getByRole("radio", { name: "2026 (current)", selected: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "2025", selected: false })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("OKR owner page and key-result sheet", () => {
  it("read-only: key result rows say status and progress in words", async () => {
    api.loadOwner.mockResolvedValue(ownerPage());
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    expect(await screen.findByRole("header", { name: "DTS" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Reach 180 people with the gospel\. Moving forward\. 90 \/ 180 people, 50 percent of the target/ }),
    ).toBeTruthy();
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId("kr-kr1"));
    expect(await screen.findByRole("progressbar", { name: "90 / 180 people, 50 percent of the target" })).toBeTruthy();
    expect(await screen.findByLabelText(/Moving forward\. 1 Oct 2026 · by Ann Lee · figure 90\. Halfway there/)).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("leader: the check-in form's controls are named, status is a radio group", async () => {
    api.loadOwner.mockResolvedValue(ownerPage({ canEdit: true, readOnly: null }));
    await show(<OwnerScreen ownerId={OWNER_ID} cycle={null} />);
    await fireEvent.press(await screen.findByTestId("kr-kr1"));
    expect(await screen.findByRole("header", { name: strings.kr.newCheckin })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Moving forward", checked: true })).toBeTruthy();
    expect(screen.getByLabelText(strings.kr.valueLabel("people"))).toBeTruthy();
    expect(screen.getByLabelText(strings.kr.commentLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.kr.save })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});
