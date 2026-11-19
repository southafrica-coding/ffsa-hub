// The Training tab on the kit (R4): every screen in its states (loading,
// no access / empty, error with Try again, saved copy, success), in light
// and dark, and at the largest text size.

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import * as RN from "react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";
import type { Me } from "@/lib/api";
import { palette } from "@/theme/tokens";

import { makeMe } from "../../../../test/fixtures";
import { getStudent, getStudents, studentListSchema, studentRecordSchema } from "../api";
import { StudentsSection } from "../components/StudentsSection";
import { TodaySection } from "../components/TodaySection";
import CheckInScreen from "../screens/CheckInScreen";
import StudentScreen from "../screens/StudentScreen";
import { TrainingScreen } from "../screens/TrainingScreen";
import { strings } from "../strings";
import { getToday, todaySchema } from "../today";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
let mockMe: { status: "loading" | "ready" | "error"; me: Me | null } = { status: "ready", me: null };
jest.mock("@/features/shell", () => ({
  ...jest.requireActual("@/features/shell"),
  useMe: () => ({ ...mockMe, error: null, refresh: jest.fn() }),
  openWebPage: jest.fn(async () => {}),
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "kim" } } }) }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("@/lib/saved-at", () => ({ formatSavedAt: () => "09:05" }));
jest.mock("../today", () => ({ ...jest.requireActual("../today"), getToday: jest.fn(), setTodayDone: jest.fn() }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getStudents: jest.fn(), getStudent: jest.fn(), saveCheckin: jest.fn(), takeCare: jest.fn() }));

const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
const NOW = new Date(2026, 10, 23, 9, 41);
const never = () => new Promise<never>(() => {});

const leader = () =>
  makeMe({
    profile: { firstName: "Kim", lastName: "Steyn", preferredName: null, avatarUrl: null, isActive: true },
    roles: [{ name: "program_leader", scopeType: "program", scopeId: "p1" }],
    permissions: [],
  });

const TODAY = todaySchema.parse({
  weekOf: "2026-11-23",
  isoWeek: "2026-W48",
  items: [
    { key: "care:c1", kind: "care", severity: 1, title: "Ruth flagged Joel", meta: "Check-in · needs care", count: null, target: { type: "student", enrollmentId: "e-joel" }, done: false },
  ],
  band: "care:c1",
  open: 1,
});

const student = (over: Record<string, unknown> = {}) => ({
  enrollmentId: "e-grace",
  name: "Grace Mwangi",
  programId: "p1",
  programName: "FFX Sep 2026",
  enrollmentStatus: "arrived",
  status: "on_track",
  lastCheckin: null,
  walkers: [],
  walkingWithMe: true,
  ...over,
});
const LIST = studentListSchema.parse({ today: "2026-11-23", students: [student({ status: "needs_care" })] });
const RECORD = studentRecordSchema.parse({ today: "2026-11-23", student: student(), checkins: [], journey: [] });

beforeEach(() => {
  jest.clearAllMocks();
  mockScheme = "light";
  mockMe = { status: "ready", me: leader() };
  cache.readCache.mockResolvedValue(null);
  (getToday as jest.Mock).mockResolvedValue(TODAY);
  (getStudents as jest.Mock).mockResolvedValue(LIST);
  (getStudent as jest.Mock).mockResolvedValue(RECORD);
});

describe.each(["light", "dark"] as const)("Training tab (%s)", (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it("loading: one labelled skeleton under the large title", async () => {
    mockMe = { status: "loading", me: null };
    await show(<TrainingScreen now={NOW} />);
    expect(screen.getByRole("header", { name: strings.back })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: strings.loading })).toBeTruthy();
  });

  it("no access: a calm empty card, no switcher", async () => {
    mockMe = { status: "ready", me: makeMe() };
    await show(<TrainingScreen now={NOW} />);
    expect(screen.getByRole("header", { name: strings.noAccess.title })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("success: the kit's segmented control, the yellow band (black text) and the list", async () => {
    await show(<TrainingScreen now={NOW} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    await waitFor(() => expect(screen.getByTestId("training-today-band")).toBeTruthy());
    expect(flat(screen.getByTestId("training-today-band").props.style).backgroundColor).toBe(palette.yellow);
    expect(screen.getByRole("header", { name: strings.today.listTitle(1) })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${strings.today.open}: Ruth flagged Joel` })).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});

describe("Today states", () => {
  it("error with nothing saved: says what happened, Try again loads again", async () => {
    (getToday as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId("training-today-error")).toBeTruthy());
    expect(screen.getByText(strings.today.errorTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.retry }));
    await waitFor(() => expect(screen.getByTestId("training-today-band")).toBeTruthy());
    expect(getToday).toHaveBeenCalledTimes(2);
  });

  it("a failed refresh keeps the saved copy with the offline note", async () => {
    cache.readCache.mockResolvedValueOnce({ savedAt: Date.now() - 60_000, data: TODAY });
    (getToday as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => expect(screen.getByText(/^Couldn't refresh\. Showing what was saved at/)).toBeTruthy());
    expect(screen.getByTestId("training-today-band")).toBeTruthy();
  });
});

describe("Students states", () => {
  it("loading", async () => {
    (getStudents as jest.Mock).mockImplementationOnce(never);
    await show(<StudentsSection onlyMine={false} />);
    expect(screen.getByRole("progressbar", { name: strings.list.loading })).toBeTruthy();
  });

  it("error + Try again", async () => {
    (getStudents as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await show(<StudentsSection onlyMine={false} />);
    await waitFor(() => expect(screen.getByTestId("training-students-error")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: strings.common.retry }));
    await waitFor(() => expect(screen.getByText("Grace Mwangi")).toBeTruthy());
  });

  it("empty", async () => {
    (getStudents as jest.Mock).mockResolvedValueOnce({ ...LIST, students: [] });
    await show(<StudentsSection onlyMine={false} />);
    await waitFor(() => expect(screen.getByRole("header", { name: strings.list.emptyTitle })).toBeTruthy());
  });

  it("success: status is a chip with its word, filters are radios", async () => {
    await show(<StudentsSection onlyMine={false} />);
    await waitFor(() => expect(screen.getByText("Grace Mwangi")).toBeTruthy());
    expect(screen.getByLabelText(strings.status.needs_care)).toBeTruthy();
    expect(screen.getAllByRole("radio").length).toBe(3);
  });
});

describe("Student record and check-in states", () => {
  it("loading: a back bar to Training and a skeleton", async () => {
    (getStudent as jest.Mock).mockImplementationOnce(never);
    await show(<StudentScreen id="e-grace" />);
    expect(screen.getByRole("button", { name: "Back to Training" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: strings.record.loading })).toBeTruthy();
  });

  it("error + Try again", async () => {
    (getStudent as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    await show(<StudentScreen id="e-grace" />);
    await waitFor(() => expect(screen.getByTestId("training-student-error")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: strings.common.retry }));
    await waitFor(() => expect(screen.getByRole("header", { name: "Grace Mwangi" })).toBeTruthy());
  });

  it("success with nothing yet: name as the title, status chip, empty journey line", async () => {
    await show(<StudentScreen id="e-grace" />);
    await waitFor(() => expect(screen.getByRole("header", { name: "Grace Mwangi" })).toBeTruthy());
    expect(screen.getByLabelText(strings.status.on_track)).toBeTruthy();
    expect(screen.getByText(strings.record.noJourney)).toBeTruthy();
    expect(screen.queryByTestId("training-care-band")).toBeNull();
  });

  it("the check-in form's back goes to the student by name", async () => {
    await show(<CheckInScreen id="e-grace" name="Grace Mwangi" />);
    await fireEvent.press(screen.getByRole("button", { name: "Back to Grace Mwangi" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("largest text size", () => {
  beforeEach(() => {
    jest.spyOn(RN, "useWindowDimensions").mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 3 });
  });
  afterEach(() => jest.restoreAllMocks());

  it("rows and titles grow instead of being cut off", async () => {
    await show(<TrainingScreen now={NOW} />);
    await waitFor(() => expect(screen.getByText("Ruth flagged Joel")).toBeTruthy());
    expect(screen.getByText("Ruth flagged Joel").props.numberOfLines).toBeUndefined();
    expect(screen.getByText(strings.titles.today("Kim")).props.numberOfLines).toBeUndefined();
    for (const label of ["Today", "Students", "Applicants", "Grades"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });
});
