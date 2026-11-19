import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";

import { LT_2025, LT_2026, detail, school, schoolList, student, yesDecision } from "../__fixtures__/fixtures";
import { getSchool, getSchools, makeStaff, recordDecision } from "../api";
import SchoolDetailScreen from "../screens/SchoolDetailScreen";
import SchoolsListScreen from "../screens/SchoolsListScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: "success" } }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getSchools: jest.fn(), getSchool: jest.fn(), recordDecision: jest.fn(), makeStaff: jest.fn() }));

const list = getSchools as jest.Mock;
const one = getSchool as jest.Mock;
const decide = recordDecision as jest.Mock;
const promote = makeStaff as jest.Mock;
const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock; writeCache: jest.Mock };
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const forbidden = () => new ApiError("forbidden", "You don't have access to this.", 403);
const sh = strings.sheet;

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  [list, one, decide, promote, openBrowser].forEach((m) => m.mockReset());
  cache.readCache.mockReset().mockResolvedValue(null);
  cache.writeCache.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockReset());
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

/** Press the confirming button of the last Alert.alert. */
function confirmAlert(text: string) {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === text)?.onPress?.();
}

describe("Schools list", () => {
  it("loading: a skeleton with a spoken label", async () => {
    list.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolsListScreen />);
    expect(screen.getByLabelText(strings.list.loading)).toBeTruthy();
  });

  it("empty: 'No Leadership Track schools yet.', no band", async () => {
    list.mockResolvedValue(schoolList({ schools: [] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.list.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("error: the message and a retry that loads again", async () => {
    list.mockRejectedValueOnce(new ApiError("network", "x")).mockResolvedValue(schoolList());
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Leadership Track 2026")).toBeTruthy();
  });

  it("permission denied: the calm Leadership-Team-only screen, no error banner", async () => {
    list.mockRejectedValue(forbidden());
    await show(<SchoolsListScreen />);
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
    expect(screen.getByText("Staff decisions are for the Leadership Team only.")).toBeTruthy();
    expect(screen.queryByText(strings.list.errorTitle)).toBeNull();
  });

  it("success: names, Archived in words, counts; opens a school; saved offline; no band", async () => {
    list.mockResolvedValue(schoolList());
    await show(<SchoolsListScreen />);
    expect(await screen.findByText("Leadership Track 2026")).toBeTruthy();
    expect(screen.getByTestId(`archived-${LT_2025}`)).toBeTruthy();
    expect(screen.queryByTestId(`archived-${LT_2026}`)).toBeNull();
    expect(screen.getByLabelText("Leadership Track 2026. 3 students. 1 yes, 1 no, 1 undecided")).toBeTruthy();
    // The counts are one line under the name (frame 12.1), and the intro sits under the title.
    expect(screen.getByText("3 students · 1 yes · 1 no · 1 undecided")).toBeTruthy();
    expect(screen.getByText("1 student · 0 yes · 0 no · 1 undecided")).toBeTruthy();
    expect(screen.getByText(strings.list.intro)).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
    await fireEvent.press(screen.getByTestId(`school-${LT_2026}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/staff-decisions/[programId]", params: { programId: LT_2026 } });
    await waitFor(() => expect(cache.writeCache).toHaveBeenCalledWith("user-1", "staff-decisions.list", expect.anything()));
  });

  it("offline: shows the saved copy with when it was saved", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: schoolList() });
    list.mockRejectedValue(new ApiError("network", "x"));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText("Leadership Track 2026")).toBeTruthy();
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
  });
});

describe("School detail", () => {
  it("loading: a skeleton with a spoken label", async () => {
    one.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(screen.getByLabelText(strings.detail.loading)).toBeTruthy();
  });

  it("error: message and retry", async () => {
    one.mockRejectedValueOnce(new ApiError("network", "x")).mockResolvedValue(detail());
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByText(strings.detail.errorTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ann Bell")).toBeTruthy();
  });

  it("permission denied: the calm screen", async () => {
    one.mockRejectedValue(forbidden());
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
  });

  it("not a Leadership Track school (404), or a bad id: says so without calling the server for a bad id", async () => {
    one.mockRejectedValue(new ApiError("http", "x", 404));
    const view = await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByText(strings.common.notFound)).toBeTruthy();
    await view.unmount();
    one.mockReset();
    await show(<SchoolDetailScreen programId="not-a-uuid" />);
    expect(await screen.findByText(strings.common.notFound)).toBeTruthy();
    expect(one).not.toHaveBeenCalled();
  });

  it("empty: nobody arrived yet, no band", async () => {
    one.mockResolvedValue(detail({ rows: [], school: school({ total: 0, yes: 0, no: 0, undecided: 0 }) }));
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByText(strings.detail.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("success: rows in words, note preview, decided by, staff tag, the one band, buttons per row", async () => {
    one.mockResolvedValue(detail());
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByText("Ann Bell")).toBeTruthy();
    expect(screen.getByText("Accepted: yes")).toBeTruthy();
    expect(screen.getByText("Accepted: no")).toBeTruthy();
    expect(screen.getByText("Not decided")).toBeTruthy();
    expect(screen.getByTestId("note-e2")).toHaveTextContent("Note: Not this year");
    expect(screen.getByTestId("counts")).toHaveTextContent("1 yes · 1 no · 1 undecided");
    expect(screen.getByText("Students · 3")).toBeTruthy();
    expect(screen.getByText("Decided 1 Oct 2026 by Lee Team")).toBeTruthy();
    expect(screen.getByText("Staff")).toBeTruthy();
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    expect(screen.getByText(strings.detail.needsYouOne)).toBeTruthy();
    // Ann: yes, account, not staff → Make staff. Ben: already staff. Cara: no account.
    expect(screen.getByTestId("make-staff-e1")).toBeTruthy();
    expect(screen.queryByTestId("make-staff-e2")).toBeNull();
    expect(screen.queryByTestId("make-staff-e3")).toBeNull();
    expect(screen.getByRole("button", { name: "Change the decision for Ann Bell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decide on Cara Lee" })).toBeTruthy();
    await fireEvent.press(screen.getByTestId("open-web"));
    expect(openBrowser).toHaveBeenCalledWith(`https://hub.example.test/schools/${LT_2026}?tab=staff_decision`, expect.anything());
    await fireEvent.press(screen.getByRole("button", { name: "Back to Staff decisions" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("the band has no button of its own, and counts every undecided student", async () => {
    one.mockResolvedValue(detail({ rows: [student({ enrollmentId: "e1" }), student({ enrollmentId: "e2", name: "Ben Cole" })] }));
    await show(<SchoolDetailScreen programId={LT_2026} />);
    const band = await screen.findByTestId("needs-you");
    expect(within(band).getByText(strings.detail.needsYouMany(2))).toBeTruthy();
    expect(within(band).queryByRole("button")).toBeNull();
  });

  it("archived school: no band even with undecided students", async () => {
    one.mockResolvedValue(detail({ school: school({ archived: true, status: "archived" }) }));
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByTestId("archived")).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });
});

describe("Decision sheet", () => {
  async function openFor(enrollmentId: string, rows = detail().rows) {
    one.mockResolvedValue(detail({ rows }));
    await show(<SchoolDetailScreen programId={LT_2026} />);
    await fireEvent.press(await screen.findByTestId(`decide-${enrollmentId}`));
  }

  it("a no needs a note: Save without one says so and sends nothing", async () => {
    await openFor("e3");
    expect(screen.getByText(sh.decideTitle("Cara Lee"))).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "No" }));
    expect(screen.getByLabelText(sh.noteLabelRequired)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("decision-save"));
    // The missing note is said on the note field itself (frame 12.4), not in a separate line.
    expect(screen.getByRole("alert")).toHaveTextContent(sh.noteRequired);
    expect(screen.getByTestId("decision-note").props.accessibilityHint).toBe(sh.noteRequired);
    expect(screen.queryByTestId("form-error")).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("decision-note"), "Needs another year");
    expect(screen.queryByText(sh.noteRequired)).toBeNull();
    decide.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId("decision-save"));
    await waitFor(() => expect(decide).toHaveBeenCalledWith(expect.anything(), { enrollmentId: "e3", accepted: false, note: "Needs another year" }));
    // A no closes the sheet and reloads.
    await waitFor(() => expect(screen.queryByTestId("decide-step")).toBeNull());
    expect(one).toHaveBeenCalledTimes(2);
  });

  it("nothing chosen: asks for yes or no first", async () => {
    await openFor("e3");
    await fireEvent.press(screen.getByTestId("decision-save"));
    expect(screen.getByTestId("form-error")).toHaveTextContent(sh.chooseFirst);
  });

  it("a yes for a non-staff student with an account goes on to Make staff, which confirms first", async () => {
    const rows = [student({ enrollmentId: "e9", name: "Dee Moyo" })];
    await openFor("e9", rows);
    decide.mockResolvedValue(undefined);
    promote.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Yes" }));
    await fireEvent.press(screen.getByTestId("decision-save"));
    expect(await screen.findByTestId("make-staff-step")).toBeTruthy();
    expect(screen.getByText(sh.makeStaffTitle("Dee Moyo"))).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Worship" }));
    await fireEvent.press(screen.getByTestId("make-staff-confirm"));
    expect(alertSpy).toHaveBeenCalledWith(sh.confirmTitle("Dee Moyo"), sh.confirmBody("Worship"), expect.anything());
    expect(promote).not.toHaveBeenCalled();
    confirmAlert(sh.confirmYes);
    await waitFor(() => expect(promote).toHaveBeenCalledWith(expect.anything(), { enrollmentId: "e9", department: "worship" }));
    await waitFor(() => expect(screen.queryByTestId("make-staff-step")).toBeNull());
  });

  it("Not now leaves them as a student", async () => {
    const rows = [student({ enrollmentId: "e9", name: "Dee Moyo" })];
    await openFor("e9", rows);
    decide.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Yes" }));
    await fireEvent.press(screen.getByTestId("decision-save"));
    await fireEvent.press(await screen.findByTestId("make-staff-later"));
    expect(screen.queryByTestId("make-staff-step")).toBeNull();
    expect(promote).not.toHaveBeenCalled();
  });

  it("the row's Make staff button opens that step; 'choose later' sends no department; a failure stays open", async () => {
    const rows = [student({ enrollmentId: "e1", decision: yesDecision })];
    one.mockResolvedValue(detail({ rows }));
    await show(<SchoolDetailScreen programId={LT_2026} />);
    await fireEvent.press(await screen.findByTestId("make-staff-e1"));
    promote.mockRejectedValueOnce(new ApiError("http", "x", 400));
    await fireEvent.press(screen.getByTestId("make-staff-confirm"));
    expect(alertSpy).toHaveBeenCalledWith(sh.confirmTitle("Ann Bell"), sh.confirmBody(null), expect.anything());
    confirmAlert(sh.confirmYes);
    expect(await screen.findByText(sh.makeStaffRejected)).toBeTruthy();
    expect(promote).toHaveBeenCalledWith(expect.anything(), { enrollmentId: "e1", department: null });
    expect(screen.getByTestId("make-staff-step")).toBeTruthy();
  });

  it("a yes for someone already staff just closes; a failed save stays open with the reason", async () => {
    await openFor("e2");
    // Ben's no is on file: the sheet starts on No with his note.
    expect(screen.getByRole("radio", { name: "No" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("decision-note").props.value).toBe("Not this year");
    decide.mockRejectedValueOnce(new ApiError("network", "x")).mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Yes" }));
    await fireEvent.press(screen.getByTestId("decision-save"));
    expect(await screen.findByText(sh.saveFailed)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("decision-save"));
    await waitFor(() => expect(screen.queryByTestId("decide-step")).toBeNull());
    expect(screen.queryByTestId("make-staff-step")).toBeNull();
  });
});
