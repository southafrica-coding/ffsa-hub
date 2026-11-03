import { fireEvent, render, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ENROLMENT_ID, application, course, enrolment, enrolmentData, programme, record, schoolsList } from "../__fixtures__/fixtures";
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
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadSchools: jest.fn(), loadEnrolment: jest.fn(), loadAttendance: jest.fn() }));

const schools = loadSchools as jest.Mock;
const detail = loadEnrolment as jest.Mock;
const attendance = loadAttendance as jest.Mock;
const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock; writeCache: jest.Mock };
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const forbidden = () => new DataError(strings.common.forbidden);

beforeEach(() => {
  [schools, detail, attendance, openBrowser].forEach((m) => m.mockReset());
  cache.readCache.mockReset().mockResolvedValue(null);
  cache.writeCache.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockReset());
});

describe("My Schools list", () => {
  it("loading: a skeleton with a spoken label", async () => {
    schools.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolsListScreen />);
    expect(screen.getByLabelText(strings.list.loading)).toBeTruthy();
  });

  it("empty: says so and offers the schools you can apply for (on the website)", async () => {
    schools.mockResolvedValue(schoolsList({ enrolments: [] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.list.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: strings.list.seeSchools }));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/my-schools", expect.anything());
  });

  it("error: the message and a retry that loads again", async () => {
    schools.mockRejectedValueOnce(new DataError(strings.common.network)).mockResolvedValue(schoolsList());
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("DTS Winter")).toBeTruthy();
  });

  it("permission denied: says it isn't available on this account", async () => {
    schools.mockRejectedValue(forbidden());
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("success: enrolment with status in words, opens its detail; attendance row; applications; saved for offline", async () => {
    schools.mockResolvedValue(
      schoolsList({
        enrolments: [enrolment({ status: "waiting_for_arrival", assigned_staff: { first_name: "Ann", last_name: "Lee", preferred_name: null, email: null } })],
        applications: [application({ id: "a2", program_id: "p9", status: "interview_scheduled", programs: { id: "p9", name: "SBS", code: "SBS" } })],
      }),
    );
    await show(<SchoolsListScreen />);
    expect(await screen.findByText("DTS Winter")).toBeTruthy();
    expect(screen.getByText("Waiting for arrival")).toBeTruthy();
    expect(screen.getByText("Walking with Ann Lee")).toBeTruthy();
    expect(screen.getByText("Interview scheduled")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`enrolment-${ENROLMENT_ID}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/schools/[id]", params: { id: ENROLMENT_ID } });
    await fireEvent.press(screen.getByTestId("attendance-row"));
    expect(mockRouter.push).toHaveBeenCalledWith("/schools/attendance");
    expect(cache.writeCache).toHaveBeenCalledWith("user-1", "schools.list", expect.anything());
  });

  it("open schools not yet applied to: exactly one yellow band, applying opens the website", async () => {
    schools.mockResolvedValue(schoolsList({ applications: [application()], openProgrammes: [programme(), programme({ id: "p2", name: "SBS Summer" })] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.list.needsYouOne("SBS Summer"))).toBeTruthy();
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    // Already applied to p1: it's not offered again.
    expect(screen.queryByTestId("open-p1")).toBeNull();
    await fireEvent.press(screen.getByTestId("open-p2"));
    expect(openBrowser).toHaveBeenLastCalledWith("https://hub.example.test/my-schools/apply/p2", expect.anything());
    await fireEvent.press(screen.getByRole("button", { name: strings.list.apply }));
    expect(openBrowser).toHaveBeenLastCalledWith("https://hub.example.test/my-schools/apply/p2", expect.anything());
  });

  it("offline with a saved copy: shows it at once with when it was saved", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: schoolsList() });
    schools.mockRejectedValue(new DataError(strings.common.network));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText("DTS Winter")).toBeTruthy();
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
  });

  it("saved copy while refreshing: 'Last updated'", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: schoolsList() });
    schools.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.common.lastUpdated("09:05"))).toBeTruthy();
  });
});

describe("Enrolment detail", () => {
  it("loading", async () => {
    detail.mockReturnValue(new Promise(() => undefined));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(screen.getByLabelText(strings.detail.loading)).toBeTruthy();
  });

  it("success: status, GPA as the big number, courses with grades, transcript on the website", async () => {
    detail.mockResolvedValue(enrolmentData({ grades: [{ course_id: "c1", letter_grade: "A" }] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText("DTS Winter")).toBeTruthy();
    expect(screen.getByLabelText(`${strings.detail.status}: Active`)).toBeTruthy();
    expect(screen.getByText("4.00")).toBeTruthy();
    expect(screen.getByText("Lecture phase")).toBeTruthy();
    expect(screen.getByText("Grade A")).toBeTruthy();
    expect(screen.getByText(strings.detail.noGrade)).toBeTruthy();
    expect(screen.getByText("1 Jul – 30 Sep 2026")).toBeTruthy();
    expect(detail).toHaveBeenCalledWith("user-1", ENROLMENT_ID);
    await fireEvent.press(screen.getByTestId("transcript"));
    expect(openBrowser).toHaveBeenCalledWith(`https://hub.example.test/my-schools/${ENROLMENT_ID}`, expect.anything());
    await fireEvent.press(screen.getByTestId("attendance-row"));
    expect(mockRouter.push).toHaveBeenCalledWith("/schools/attendance");
  });

  it("empty: no grades and no courses yet", async () => {
    detail.mockResolvedValue(enrolmentData({ courses: [] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText(strings.detail.notGraded)).toBeTruthy();
    expect(screen.getByText(strings.detail.noCourses)).toBeTruthy();
  });

  it("marks the running course, in words", async () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(today.getTime() - 10 * 86_400_000);
    const end = new Date(today.getTime() + 10 * 86_400_000);
    detail.mockResolvedValue(enrolmentData({ courses: [course({ start_date: iso(start), end_date: iso(end) })] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByTestId("mark-now")).toBeTruthy();
    expect(screen.getByText(strings.detail.now)).toBeTruthy();
  });

  it("not found (someone else's, removed, or a bad link): says so with a way back", async () => {
    detail.mockResolvedValue(null);
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText(strings.detail.notFoundTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.back }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("a malformed id never reaches the database", async () => {
    await show(<EnrolmentScreen id="not-an-id" />);
    expect(await screen.findByText(strings.detail.notFoundTitle)).toBeTruthy();
    expect(detail).not.toHaveBeenCalled();
  });

  it("error, then retry", async () => {
    detail.mockRejectedValueOnce(new DataError(strings.common.generic)).mockResolvedValue(enrolmentData());
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText(strings.detail.errorTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Lecture phase")).toBeTruthy();
  });

  it("permission denied", async () => {
    detail.mockRejectedValue(forbidden());
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("offline with a saved copy", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: enrolmentData() });
    detail.mockRejectedValue(new DataError(strings.common.network));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText("Lecture phase")).toBeTruthy();
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(cache.readCache).toHaveBeenCalledWith("user-1", `schools.enrolment.${ENROLMENT_ID}`);
  });
});

describe("My Attendance", () => {
  it("loading", async () => {
    attendance.mockReturnValue(new Promise(() => undefined));
    await show(<AttendanceScreen />);
    expect(screen.getByLabelText(strings.attendance.loading)).toBeTruthy();
  });

  it("empty: plain words, no percentage", async () => {
    attendance.mockResolvedValue([]);
    await show(<AttendanceScreen />);
    expect(await screen.findByText(strings.attendance.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId("summary")).toBeNull();
  });

  it("success: the summary, a count per status in words, and every record", async () => {
    attendance.mockResolvedValue([
      record(),
      record({ id: "r2", status: "late", checked_in_at: new Date(2026, 10, 4, 8, 7).toISOString() }),
      record({ id: "r3", status: "absent", events: null }),
      record({ id: "r4" }),
    ]);
    await show(<AttendanceScreen />);
    expect(await screen.findByText("50%")).toBeTruthy();
    expect(screen.getByText(strings.attendance.summary(2, 4))).toBeTruthy();
    expect(screen.getByLabelText(strings.attendance.summaryA11y(50, 2, 4))).toBeTruthy();
    expect(screen.getByTestId("breakdown")).toHaveTextContent("Present 2 · Late 1 · Absent 1");
    expect(screen.getByText(strings.attendance.checkedIn("08:07"))).toBeTruthy();
    expect(screen.getByText(strings.attendance.eventRemoved)).toBeTruthy();
    expect(screen.getAllByText("Main hall").length).toBeGreaterThan(0);
    expect(screen.getByTestId("status-absent")).toBeTruthy();
  });

  it("error, then retry", async () => {
    attendance.mockRejectedValueOnce(new DataError(strings.common.network)).mockResolvedValue([record()]);
    await show(<AttendanceScreen />);
    expect(await screen.findByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("100%")).toBeTruthy();
  });

  it("permission denied", async () => {
    attendance.mockRejectedValue(forbidden());
    await show(<AttendanceScreen />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("offline with a saved copy", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: [record()] });
    attendance.mockRejectedValue(new DataError(strings.common.network));
    await show(<AttendanceScreen />);
    expect(await screen.findByText("Morning lecture")).toBeTruthy();
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
  });
});
