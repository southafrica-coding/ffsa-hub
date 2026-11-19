import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";

import { CAMS, KIDS, MEDIA, detail, member, ministry, ministryList } from "../__fixtures__/fixtures";
import { approveMember, getMinistries, getMinistry } from "../api";
import { MinistriesGate } from "../screens/MinistriesGate";
import MinistriesListScreen from "../screens/MinistriesListScreen";
import MinistryDetailScreen from "../screens/MinistryDetailScreen";
import { useMinistriesAccess } from "../shortcut";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: "success" } }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getMinistries: jest.fn(), getMinistry: jest.fn(), approveMember: jest.fn() }));
jest.mock("../shortcut", () => ({ useMinistriesAccess: jest.fn(() => "allowed") }));

const list = getMinistries as jest.Mock;
const one = getMinistry as jest.Mock;
const approve = approveMember as jest.Mock;
const access = useMinistriesAccess as jest.Mock;
const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock; writeCache: jest.Mock };
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const forbidden = () => new ApiError("forbidden", "You don't have access to this.", 403);

beforeEach(() => {
  [list, one, approve, openBrowser].forEach((m) => m.mockReset());
  access.mockReset().mockReturnValue("allowed");
  cache.readCache.mockReset().mockResolvedValue(null);
  cache.writeCache.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockReset());
});

describe("Ministries list", () => {
  it("loading: a skeleton with a spoken label", async () => {
    list.mockReturnValue(new Promise(() => undefined));
    await show(<MinistriesListScreen />);
    expect(screen.getByLabelText(strings.list.loading)).toBeTruthy();
  });

  it("empty: says so calmly, no band", async () => {
    list.mockResolvedValue(ministryList({ scope: "all", ministries: [] }));
    await show(<MinistriesListScreen />);
    expect(await screen.findByText(strings.list.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("error: the message and a retry that loads again", async () => {
    list.mockRejectedValueOnce(new ApiError("network", "x")).mockResolvedValue(ministryList());
    await show(<MinistriesListScreen />);
    expect(await screen.findByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Media")).toBeTruthy();
  });

  it("permission denied: the calm no-access screen, no error banner", async () => {
    list.mockRejectedValue(forbidden());
    await show(<MinistriesListScreen />);
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
    expect(screen.getByText(strings.common.forbidden)).toBeTruthy();
    expect(screen.queryByText(strings.list.errorTitle)).toBeNull();
  });

  it("success (leader): rows with people count, description and Retired in words; opens the detail; saved offline", async () => {
    list.mockResolvedValue(ministryList({ ministries: [ministry(), ministry({ id: KIDS, name: "Kids", description: null, isActive: false, peopleCount: 1 })] }));
    await show(<MinistriesListScreen />);
    expect(await screen.findByText("Media")).toBeTruthy();
    expect(screen.getByText("People · 2 ministries you lead")).toBeTruthy();
    expect(screen.getByText("4 people · Cameras and sound")).toBeTruthy();
    expect(screen.getByText("1 person")).toBeTruthy();
    expect(screen.getByTestId(`retired-${KIDS}`)).toBeTruthy();
    expect(screen.getByLabelText("Kids. Retired. 1 person")).toBeTruthy();
    // One section: no headings; not an admin: no create row.
    expect(screen.queryByText("Main ministries")).toBeNull();
    expect(screen.queryByTestId("create-ministry")).toBeNull();
    await fireEvent.press(screen.getByTestId(`ministry-${MEDIA}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/ministries/[id]", params: { id: MEDIA } });
    await waitFor(() => expect(cache.writeCache).toHaveBeenCalledWith("user-1", "ministries.list", expect.anything()));
    await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
  });

  it("admin: Main / Part-time headings when both exist, and Create a ministry opens the website", async () => {
    list.mockResolvedValue(
      ministryList({ scope: "all", canCreate: true, ministries: [ministry(), ministry({ id: KIDS, name: "Kids", ministryType: "part_time" })] }),
    );
    await show(<MinistriesListScreen />);
    expect(await screen.findByText("Main ministries")).toBeTruthy();
    expect(screen.getByText("Part-time ministries")).toBeTruthy();
    // Each heading is read with its count.
    expect(screen.getByRole("header", { name: "Main ministries, 1" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Part-time ministries, 1" })).toBeTruthy();
    expect(screen.getByText("People · 2 ministries")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("create-ministry"));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/ministry", expect.anything());
  });

  it("offline: shows the saved copy with when it was saved", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: ministryList() });
    list.mockRejectedValue(new ApiError("network", "x"));
    await show(<MinistriesListScreen />);
    expect(await screen.findByText("Media")).toBeTruthy();
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
  });
});

describe("Ministry detail", () => {
  it("loading: a skeleton with a spoken label", async () => {
    one.mockReturnValue(new Promise(() => undefined));
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(screen.getByLabelText(strings.detail.loading)).toBeTruthy();
  });

  it("error: message and retry", async () => {
    one.mockRejectedValueOnce(new ApiError("timeout", "x")).mockResolvedValue(detail());
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(await screen.findByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bo Dube")).toBeTruthy();
  });

  it("permission denied (leader of another ministry): calm no-access screen", async () => {
    one.mockRejectedValue(forbidden());
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
  });

  it("an id that isn't a ministry: 'doesn't exist' without asking the server", async () => {
    await show(<MinistryDetailScreen id="new" />);
    expect(await screen.findByText(strings.common.notFound)).toBeTruthy();
    expect(one).not.toHaveBeenCalled();
  });

  it("empty team", async () => {
    one.mockResolvedValue(detail({ roster: [] }));
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(await screen.findByTestId("empty-team")).toBeTruthy();
  });

  it("read-only (Leadership Team): team grouped by category with role words, no approve, no manage link, no band", async () => {
    one.mockResolvedValue(
      detail({
        canManage: false,
        subcategories: [{ id: CAMS, name: "Cameras" }],
        roster: [
          member({ membershipId: "m1", name: "Ann Lee", role: "leader", categoryIds: [CAMS], pointLeaderCategoryIds: [CAMS] }),
          member({ membershipId: "m2", name: "Bo Dube", status: "pending" }),
        ],
      }),
    );
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(await screen.findByText("Ann Lee")).toBeTruthy();
    expect(screen.getByText("Main ministry")).toBeTruthy();
    expect(screen.getByTestId("read-only")).toBeTruthy();
    expect(screen.getByText("Cameras (1)")).toBeTruthy();
    expect(screen.getByText("Uncategorized (1)")).toBeTruthy();
    expect(screen.getByText("Category point leader")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByLabelText("Ann Lee. Category point leader. ann@example.org")).toBeTruthy();
    expect(screen.queryByTestId("approve-m2")).toBeNull();
    expect(screen.queryByTestId("manage-web")).toBeNull();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("manager: the one yellow band counts pending people; the manage link opens this ministry on the website", async () => {
    one.mockResolvedValue(detail({ roster: [member({ membershipId: "m2", name: "Bo Dube", status: "pending" })] }));
    await show(<MinistryDetailScreen id={MEDIA} />);
    const band = await screen.findByTestId("needs-you");
    expect(within(band).getByText(strings.detail.needsYouOne("Bo Dube"))).toBeTruthy();
    // The band only tells: Approve is on the pending person's own row.
    expect(within(band).queryByRole("button")).toBeNull();
    expect(within(screen.getByTestId("member-__none__-m2")).getByRole("button", { name: "Approve Bo Dube" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Team, 1" })).toBeTruthy();
    expect(screen.queryByTestId("read-only")).toBeNull();
    await fireEvent.press(screen.getByTestId("manage-web"));
    expect(openBrowser).toHaveBeenCalledWith(`https://hub.example.test/ministry/${MEDIA}`, expect.anything());
  });

  it("several people waiting: still one band, with the count", async () => {
    one.mockResolvedValue(
      detail({ roster: [member({ membershipId: "m2", name: "Bo Dube", status: "pending" }), member({ membershipId: "m3", name: "Cy Nel", status: "pending" })] }),
    );
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(await screen.findByText(strings.detail.needsYouMany(2))).toBeTruthy();
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Back to Ministries" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("manager approves a pending person after confirming; the team reloads", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    one.mockResolvedValueOnce(detail({ roster: [member({ membershipId: "m2", name: "Bo Dube", status: "pending" })] })).mockResolvedValue(
      detail({ roster: [member({ membershipId: "m2", name: "Bo Dube" })] }),
    );
    approve.mockResolvedValue(undefined);
    await show(<MinistryDetailScreen id={MEDIA} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Approve Bo Dube" }));
    expect(alert).toHaveBeenCalledWith("Approve Bo Dube?", "They'll join Media straight away.", expect.any(Array));
    expect(approve).toHaveBeenCalledWith(expect.anything(), MEDIA, "m2");
    await waitFor(() => expect(screen.queryByTestId("needs-you")).toBeNull());
    expect(one).toHaveBeenCalledTimes(2);
  });

  it("'Not now' leaves things as they are", async () => {
    jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons) => buttons?.[0]?.onPress?.());
    one.mockResolvedValue(detail({ roster: [member({ membershipId: "m2", name: "Bo Dube", status: "pending" })] }));
    await show(<MinistryDetailScreen id={MEDIA} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Approve Bo Dube" }));
    expect(approve).not.toHaveBeenCalled();
  });

  it("a failed approve says what to do next", async () => {
    jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    one.mockResolvedValue(detail({ roster: [member({ membershipId: "m2", name: "Bo Dube", status: "pending" })] }));
    approve.mockRejectedValue(forbidden());
    await show(<MinistryDetailScreen id={MEDIA} />);
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Approve Bo Dube" }));
    });
    expect(await screen.findByText(strings.detail.approveForbidden)).toBeTruthy();
  });
});

describe("Ministries gate", () => {
  it("checking: a skeleton", async () => {
    access.mockReturnValue("checking");
    await show(
      <MinistriesGate>
        <></>
      </MinistriesGate>,
    );
    expect(screen.getByLabelText(strings.gate.checking)).toBeTruthy();
  });

  it("not allowed: the calm message, the screen isn't shown", async () => {
    access.mockReturnValue("notAllowed");
    await show(
      <MinistriesGate>
        <MinistriesListScreen />
      </MinistriesGate>,
    );
    expect(screen.getByTestId("ministries-not-allowed")).toBeTruthy();
    expect(screen.getByText(strings.gate.title)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it("unknown (offline, nothing remembered): the screen is shown and handles it", async () => {
    access.mockReturnValue("unknown");
    list.mockResolvedValue(ministryList());
    await show(
      <MinistriesGate>
        <MinistriesListScreen />
      </MinistriesGate>,
    );
    expect(await screen.findByText("Media")).toBeTruthy();
  });
});
