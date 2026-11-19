// Accessibility checks for My Schools, the enrolment detail and My Attendance:
// every tappable has a role and a name, headings are headers, status is in
// words, and decoration stays out of the screen reader's way.

import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";

import { ENROLMENT_ID, enrolmentData, programme, record, schoolsList } from "../__fixtures__/fixtures";
import { DataError, loadAttendance, loadEnrolment, loadSchools } from "../data";
import AttendanceScreen from "../screens/AttendanceScreen";
import EnrolmentScreen from "../screens/EnrolmentScreen";
import SchoolsListScreen from "../screens/SchoolsListScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("@/lib/saved-at", () => ({ formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadSchools: jest.fn(), loadEnrolment: jest.fn(), loadAttendance: jest.fn() }));

const schools = loadSchools as jest.Mock;
const detail = loadEnrolment as jest.Mock;
const attendance = loadAttendance as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const audit = () => auditTappables(screen.container as never);

beforeEach(() => {
  [schools, detail, attendance].forEach((m) => m.mockReset());
});

describe("My Schools list", () => {
  it("loading / error / permission denied: labelled, retry is a named button", async () => {
    schools.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolsListScreen />);
    expect(screen.getByRole("progressbar", { name: strings.list.loading })).toBeTruthy();
    expect(audit()).toEqual([]);
    await screen.unmount();

    schools.mockRejectedValue(new DataError(strings.common.forbidden));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("empty: the way out is a named button", async () => {
    schools.mockResolvedValue(schoolsList({ enrolments: [] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByRole("header", { name: strings.list.emptyTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.list.seeSchools })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("success: header, enrolment row says name + status in words, chevrons hidden", async () => {
    schools.mockResolvedValue(schoolsList({ openProgrammes: [programme({ id: "p9", name: "SBS" })] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByRole("header", { name: strings.list.title })).toBeTruthy();
    const row = screen.getByRole("button", { name: /^DTS Winter\. Active\./ });
    expect(row.props.accessibilityHint).toBe(strings.list.enrolmentHint);
    expect(screen.getByRole("button", { name: strings.list.apply })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^SBS\. Opens in browser/ })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("Enrolment detail", () => {
  it("success: status in words, GPA read as one figure, links named", async () => {
    detail.mockResolvedValue(enrolmentData({ grades: [{ course_id: "c1", letter_grade: "A" }] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByLabelText(`${strings.detail.status}: Active`)).toBeTruthy();
    expect(screen.getByLabelText(`${strings.detail.gpa}, 4.00`)).toBeTruthy();
    expect(screen.getByRole("link", { name: `${strings.detail.transcript}. Opens in browser` })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.detail.attendance })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("not found: a header and a named way back", async () => {
    detail.mockResolvedValue(null);
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByRole("header", { name: strings.detail.notFoundTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.back })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("My Attendance", () => {
  it("summary reads the percentage and the per-status counts as one", async () => {
    attendance.mockResolvedValue([record(), record({ id: "r2", status: "absent" })]);
    await show(<AttendanceScreen />);
    const summary = await screen.findByTestId("summary");
    expect(summary.props.accessibilityLabel).toBe(
      strings.a11y.withBreakdown(strings.attendance.summaryA11y(50, 1, 2), "Present 1, Absent 1"),
    );
    // Each record says its status in words, not colour.
    expect(screen.getByLabelText(/\. Absent\./)).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("empty: a header, nothing to tap", async () => {
    attendance.mockResolvedValue([]);
    await show(<AttendanceScreen />);
    expect(await screen.findByRole("header", { name: strings.attendance.emptyTitle })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("withBreakdown leaves the summary alone when there is no breakdown", () => {
    expect(strings.a11y.withBreakdown("Present at 1 of 1 session, 100 percent", "")).toBe("Present at 1 of 1 session, 100 percent");
  });
});
