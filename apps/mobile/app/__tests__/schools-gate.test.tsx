import { fireEvent, render, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ENROLMENT_ID, enrolmentData, record, schoolsList } from "@/features/schools/__fixtures__/fixtures";
import { loadAttendance, loadEnrolment, loadSchools } from "@/features/schools/data";
import type { SchoolsAccess } from "@/features/schools/logic";
import { strings } from "@/features/schools/strings";

import EnrolmentRoute from "../(app)/schools/[id]";
import AttendanceRoute from "../(app)/schools/attendance";
import SchoolsRoute from "../(app)/schools/index";

// A feed item, a notification or a link can open /schools without the Home
// shortcut, so the routes ask the same question Home does (UX only).

let mockAccess: SchoolsAccess = "allowed";
jest.mock("@/features/schools/shortcut", () => ({ useSchoolsAccess: () => mockAccess }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: "11111111-2222-4333-8444-555555555555" }),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("@/features/schools/data", () => ({
  ...jest.requireActual("@/features/schools/data"),
  loadSchools: jest.fn(),
  loadEnrolment: jest.fn(),
  loadAttendance: jest.fn(),
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

beforeEach(() => {
  mockAccess = "allowed";
  openBrowser.mockReset();
  (loadSchools as jest.Mock).mockReset().mockResolvedValue(schoolsList());
  (loadEnrolment as jest.Mock).mockReset().mockResolvedValue(enrolmentData());
  (loadAttendance as jest.Mock).mockReset().mockResolvedValue([record()]);
});

describe("/schools routes", () => {
  it("not eligible: a calm explanation and a way to the website, no school data read", async () => {
    mockAccess = "notAllowed";
    await show(<SchoolsRoute />);
    expect(screen.getByTestId("schools-not-eligible")).toBeTruthy();
    expect(screen.getByText(strings.gate.title)).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.gate.title })).toBeTruthy();
    expect(loadSchools).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: strings.gate.openWeb });
    expect(button.props.accessibilityHint).toBe(strings.gate.openWebHint);
    await fireEvent.press(button);
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/my-schools", expect.anything());
  });

  it("not eligible: an enrolment link gets the same screen", async () => {
    mockAccess = "notAllowed";
    await show(<EnrolmentRoute />);
    expect(screen.getByTestId("schools-not-eligible")).toBeTruthy();
    expect(loadEnrolment).not.toHaveBeenCalled();
  });

  it("checking: a spoken loading state, nothing else", async () => {
    mockAccess = "checking";
    await show(<SchoolsRoute />);
    expect(screen.getByLabelText(strings.gate.checking)).toBeTruthy();
    expect(screen.queryByTestId("schools-not-eligible")).toBeNull();
    expect(loadSchools).not.toHaveBeenCalled();
  });

  it("allowed: the list as before", async () => {
    await show(<SchoolsRoute />);
    expect(await screen.findByText("DTS Winter")).toBeTruthy();
    expect(screen.queryByTestId("schools-not-eligible")).toBeNull();
  });

  it("couldn't tell (offline, nothing remembered): the screen shows, with its own offline states", async () => {
    mockAccess = "unknown";
    await show(<EnrolmentRoute />);
    expect(loadEnrolment).toHaveBeenCalledWith("u1", ENROLMENT_ID);
    expect(screen.queryByTestId("schools-not-eligible")).toBeNull();
  });

  it("My Attendance is event check-ins, so it isn't behind the gate", async () => {
    mockAccess = "notAllowed";
    await show(<AttendanceRoute />);
    expect(screen.queryByTestId("schools-not-eligible")).toBeNull();
    expect(loadAttendance).toHaveBeenCalledWith("u1");
  });
});
