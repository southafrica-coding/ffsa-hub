// The redesign of My Schools, the enrolment and My Attendance (frames
// 8.1–8.6): the header and its back target, the one yellow band, sections
// with count chips, status chips that say a word, and the gate as its own
// screen. Behaviour is covered in screens.test.tsx.

import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables, tappableSizes } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";

import { ENROLMENT_ID, application, course, enrolment, enrolmentData, programme, record, schoolsList } from "../__fixtures__/fixtures";
import { loadAttendance, loadEnrolment, loadSchools } from "../data";
import type { SchoolsAccess } from "../logic";
import AttendanceScreen from "../screens/AttendanceScreen";
import EnrolmentScreen from "../screens/EnrolmentScreen";
import { SchoolsGate } from "../screens/SchoolsGate";
import SchoolsListScreen from "../screens/SchoolsListScreen";
import { strings } from "../strings";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
let mockAccess: SchoolsAccess = "allowed";
jest.mock("../shortcut", () => ({ useSchoolsAccess: () => mockAccess }));
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
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const staff = { first_name: "Test", last_name: "Staff A", preferred_name: null, email: null };

beforeEach(() => {
  mockScheme = "light";
  mockAccess = "allowed";
  [schools, detail, attendance, openBrowser].forEach((m) => m.mockReset());
  Object.values(mockRouter).forEach((f) => f.mockReset());
});

describe("My Schools (8.1)", () => {
  const full = () =>
    schoolsList({
      enrolments: [
        enrolment({ status: "arrived", assigned_staff: staff }),
        enrolment({ id: "22222222-2222-4333-8444-555555555555", status: "graduated", programs: programme({ id: "p3", name: "FFX Foundations" }) }),
      ],
      applications: [application({ id: "a2", program_id: "p9", status: "interview_scheduled", programs: { id: "p9", name: "SBS", code: "SBS" } })],
      openProgrammes: [programme({ id: "p2", name: "Missions School 2027", code: "MS27", credit_hours: 24 })],
    });

  it("header: eyebrow with the enrolment count, caps title as the heading, Back goes to Home", async () => {
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    expect(await screen.findByText("Training & education · 2")).toBeTruthy();
    const title = screen.getByRole("header", { name: strings.list.title });
    expect(flat(title)).toMatchObject({ fontFamily: "Roboto_900Black", textTransform: "uppercase" });
    await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
  });

  it("before the data arrives the eyebrow has no count", async () => {
    schools.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolsListScreen />);
    expect(screen.getByText(strings.list.context)).toBeTruthy();
  });

  it("the one yellow band: yellow fill, black text, and its button opens the application on the website", async () => {
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    const band = await screen.findByTestId("needs-you");
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    expect(flat(band)).toMatchObject({ backgroundColor: colors.light.accent, borderRadius: 8 });
    expect(flat(within(band).getByText(strings.list.needsYouOne("Missions School 2027"))).color).toBe(colors.light.onAccent);
    await fireEvent.press(within(band).getByRole("button", { name: strings.list.apply }));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/my-schools/apply/p2", expect.anything());
  });

  it("several open schools: the band counts them and opens the schools page", async () => {
    schools.mockResolvedValue(schoolsList({ openProgrammes: [programme({ id: "p2" }), programme({ id: "p3" })] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText(strings.list.needsYouMany(2))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.list.apply }));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/my-schools", expect.anything());
  });

  it("sections carry their count; each is one heading", async () => {
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    expect(await screen.findByRole("header", { name: `${strings.list.enrolments}, 2` })).toBeTruthy();
    expect(screen.getByRole("header", { name: `${strings.list.applications}, 1` })).toBeTruthy();
    expect(screen.getByRole("header", { name: `${strings.list.open}, 1` })).toBeTruthy();
  });

  it("enrolment rows: 'Walking with …' or 'Enrolled …', and the status as a word in a chip", async () => {
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    const first = await screen.findByTestId(`enrolment-${ENROLMENT_ID}`);
    expect(within(first).getByText("Walking with Test Staff A")).toBeTruthy();
    expect(within(first).getByTestId("status-arrived")).toHaveTextContent("Arrived");
    expect(flat(within(first).getByTestId("status-arrived")).borderColor).toBe(colors.light.positiveText);
    const second = screen.getByTestId("enrolment-22222222-2222-4333-8444-555555555555");
    expect(within(second).getByText("Enrolled 1 Jul 2026")).toBeTruthy();
    expect(within(second).getByTestId("status-graduated")).toHaveTextContent("Graduated");
  });

  it.each([
    ["waiting_for_arrival", "Waiting for arrival"],
    ["on_hold", "On hold"],
    ["decided_to_leave", "Decided to leave"],
    ["dismissed", "Dismissed"],
    ["withdrawn", "Withdrawn"],
    ["something_new", "Something new"],
  ])("status %s reads '%s'", async (status, word) => {
    schools.mockResolvedValue(schoolsList({ enrolments: [enrolment({ status })] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByTestId(`status-${status}`)).toHaveTextContent(word);
  });

  it("applications are read-only rows (nothing to tap); open schools are links to the website", async () => {
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    const row = await screen.findByTestId("application-a2");
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.accessibilityLabel).toBe("SBS. Interview scheduled. Sent 2 May 2026");
    const open = screen.getByRole("link", { name: "Missions School 2027. Opens in browser" });
    expect(within(open).getByText("MS27 · 24 credit hours")).toBeTruthy();
  });

  it("no enrolments (8.4): the empty card sits in the list with My attendance still reachable", async () => {
    schools.mockResolvedValue(schoolsList({ enrolments: [] }));
    await show(<SchoolsListScreen />);
    expect(await screen.findByText("Training & education · 0")).toBeTruthy();
    expect(screen.getByRole("header", { name: `${strings.list.enrolments}, 0` })).toBeTruthy();
    expect(screen.getByTestId("empty")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("attendance-row"));
    expect(mockRouter.push).toHaveBeenCalledWith("/schools/attendance");
  });

  it("every tappable is at least 44pt", async () => {
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    await screen.findByTestId("needs-you");
    const sizes = tappableSizes(screen.container as never, StyleSheet.flatten as never);
    expect(sizes.length).toBeGreaterThan(4);
    for (const t of sizes) expect(t.minHeight ?? t.height).toBeGreaterThanOrEqual(44);
  });

  it("dark mode: page text and list groups use the dark tokens; the band stays yellow with black text", async () => {
    mockScheme = "dark";
    schools.mockResolvedValue(full());
    await show(<SchoolsListScreen />);
    const title = await screen.findByRole("header", { name: strings.list.title });
    expect(flat(title).color).toBe(colors.dark.text);
    const group = screen.getByTestId(`enrolment-${ENROLMENT_ID}`).parent!;
    expect(flat(group)).toMatchObject({ backgroundColor: colors.dark.raised, borderColor: colors.dark.rule });
    expect(flat(screen.getByTestId("needs-you")).backgroundColor).toBe(colors.dark.accent);
    expect(flat(screen.getByTestId("status-arrived")).borderColor).toBe(colors.dark.positiveText);
  });
});

describe("Enrolment (8.2, 8.6)", () => {
  it("header: code and enrolment date above the school's name; Back goes to My Schools", async () => {
    detail.mockResolvedValue(enrolmentData());
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByText("DTS-W · enrolled 1 Jul 2026")).toBeTruthy();
    expect(screen.getByRole("header", { name: "DTS Winter" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to My Schools" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("status chip, 'Walking with …', and 'Arrive …' only while the arrival is ahead", async () => {
    detail.mockResolvedValue(
      enrolmentData({
        enrolment: { status: "arrived", assigned_staff: staff },
        courses: [course({ arrival_date: "2999-01-03", start_date: "2999-01-04", end_date: "2999-02-26" })],
      }),
    );
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByTestId("enrolment-status")).toHaveTextContent("Arrived");
    expect(screen.getByTestId("arrival")).toHaveTextContent("Arrive 3 Jan 2999");
    expect(screen.getByText("Walking with Test Staff A")).toBeTruthy();
    expect(screen.getByTestId("mark-next")).toHaveTextContent(strings.detail.next);
  });

  it("no arrival line once it has passed", async () => {
    detail.mockResolvedValue(enrolmentData({ courses: [course({ arrival_date: "2020-01-03" })] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    await screen.findByTestId("enrolment-status");
    expect(screen.queryByTestId("arrival")).toBeNull();
  });

  it("figure strip: GPA is the big number; credits earned 'of N'; credits attempted", async () => {
    detail.mockResolvedValue(enrolmentData({ grades: [{ course_id: "c1", letter_grade: "A-" }] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    const gpa = await screen.findByLabelText(`${strings.detail.gpa}, 3.70`);
    expect(flat(within(gpa).getByText("3.70"))).toMatchObject({ fontSize: 32, fontVariant: ["tabular-nums"] });
    expect(screen.getByLabelText(`${strings.detail.creditsEarned}, 6, ${strings.detail.creditsOf(12)}`)).toBeTruthy();
    expect(screen.getByLabelText(`${strings.detail.creditsAttempted}, 6`)).toBeTruthy();
  });

  it("courses: a counted section; each row has dates, code and credits, and its grade in words", async () => {
    detail.mockResolvedValue(
      enrolmentData({
        grades: [{ course_id: "c1", letter_grade: "B" }],
        courses: [course(), course({ id: "c2", code: "DTS-O", name: "Outreach phase", sequence: 2, start_date: null, end_date: null })],
      }),
    );
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByRole("header", { name: `${strings.detail.courses}, 2` })).toBeTruthy();
    const first = screen.getByTestId("course-c1");
    expect(within(first).getByText("1 Jul – 30 Sep 2026")).toBeTruthy();
    expect(within(first).getByText("DTS-L · 6 credit hours")).toBeTruthy();
    expect(within(first).getByText("Grade B")).toBeTruthy();
    expect(first.props.accessibilityRole).toBeUndefined();
    const second = screen.getByTestId("course-c2");
    expect(within(second).getByText(strings.common.datesTbc)).toBeTruthy();
    expect(within(second).getByText(strings.detail.noGrade)).toBeTruthy();
  });

  it("not found (8.6): My Schools header, a calm card and Back", async () => {
    detail.mockResolvedValue(null);
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    expect(await screen.findByTestId("not-found")).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.list.title })).toBeTruthy();
    expect(screen.getByText(strings.detail.notFound)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to My Schools" })).toBeTruthy();
  });

  it("dark mode: the figure strip's rules and the course list use the dark tokens", async () => {
    mockScheme = "dark";
    detail.mockResolvedValue(enrolmentData({ grades: [{ course_id: "c1", letter_grade: "A" }] }));
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    const gpa = await screen.findByLabelText(`${strings.detail.gpa}, 4.00`);
    expect(flat(gpa.parent!).borderColor).toBe(colors.dark.text);
    expect(flat(screen.getByTestId("course-c1").parent!)).toMatchObject({ backgroundColor: colors.dark.raised });
  });
});

describe("My attendance (8.3)", () => {
  it("header says Personal; Back goes to My Schools", async () => {
    attendance.mockResolvedValue([record()]);
    await show(<AttendanceScreen />);
    expect(await screen.findByText(strings.attendance.context)).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.attendance.title })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to My Schools" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("the percentage is the big number under 'Present', with the count and a breakdown that includes Late", async () => {
    attendance.mockResolvedValue([record(), record({ id: "r2" }), record({ id: "r3", status: "late" }), record({ id: "r4", status: "excused" })]);
    await show(<AttendanceScreen />);
    const summary = await screen.findByTestId("summary");
    expect(flat(within(summary).getByText("50%"))).toMatchObject({ fontSize: 32 });
    expect(within(summary).getByText(strings.attendance.present)).toBeTruthy();
    expect(within(summary).getByText("2 of 4 sessions")).toBeTruthy();
    expect(screen.getByTestId("breakdown")).toHaveTextContent("Present 2 · Late 1 · Excused 1");
    expect(screen.getByRole("header", { name: `${strings.attendance.records}, ${strings.attendance.logged(4)}` })).toBeTruthy();
  });

  it("rows: date block, event, check-in time or location, and the status as a word", async () => {
    attendance.mockResolvedValue([
      record({ checked_in_at: new Date(2026, 10, 3, 8, 5).toISOString() }),
      record({ id: "r2", status: "excused" }),
      record({ id: "r3", status: "absent", events: { id: "e3", title: "Outreach prep", start_date: null, location: null } }),
    ]);
    await show(<AttendanceScreen />);
    const first = await screen.findByTestId("attendance-r1");
    expect(within(first).getByText("Checked in 08:05")).toBeTruthy();
    expect(within(first).getByTestId("status-present")).toHaveTextContent("Present");
    expect(first.props.accessibilityLabel).toBe("Morning lecture. 3 Nov 2026. Present. Checked in 08:05");
    expect(within(screen.getByTestId("attendance-r2")).getByText("Main hall")).toBeTruthy();
    expect(within(screen.getByTestId("attendance-r2")).getByTestId("status-excused")).toHaveTextContent("Excused");
    expect(within(screen.getByTestId("attendance-r3")).getByText(strings.attendance.locationTbc)).toBeTruthy();
    expect(flat(screen.getByTestId("status-absent")).borderColor).toBe(colors.light.danger);
    // Nothing to tap but Back.
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("empty: the card sits under a '0 logged' heading", async () => {
    attendance.mockResolvedValue([]);
    await show(<AttendanceScreen />);
    expect(await screen.findByTestId("empty")).toBeTruthy();
    expect(screen.getByRole("header", { name: `${strings.attendance.records}, ${strings.attendance.logged(0)}` })).toBeTruthy();
  });
});

describe("Gate (8.5)", () => {
  it("not for you: its own screen with the header, the explanation and the way to the website", async () => {
    mockAccess = "notAllowed";
    await show(
      <SchoolsGate>
        <SchoolsListScreen />
      </SchoolsGate>,
    );
    expect(screen.getByText(strings.list.context)).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.list.title })).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.gate.title })).toBeTruthy();
    expect(screen.getByText(strings.gate.body)).toBeTruthy();
    expect(schools).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: strings.gate.openWeb }));
    expect(openBrowser).toHaveBeenCalledWith("https://hub.example.test/my-schools", expect.anything());
    await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("checking: a spoken loading state under the same header", async () => {
    mockAccess = "checking";
    await show(
      <SchoolsGate>
        <SchoolsListScreen />
      </SchoolsGate>,
    );
    expect(screen.getByRole("progressbar", { name: strings.gate.checking })).toBeTruthy();
    expect(schools).not.toHaveBeenCalled();
  });

  it("allowed, or couldn't tell: the screen itself", async () => {
    mockAccess = "unknown";
    schools.mockResolvedValue(schoolsList());
    await show(
      <SchoolsGate>
        <SchoolsListScreen />
      </SchoolsGate>,
    );
    expect(await screen.findByText("DTS Winter")).toBeTruthy();
  });
});
