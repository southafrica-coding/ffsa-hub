import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";

import { getStudent, getStudents, saveCheckin, studentListSchema, studentRecordSchema, takeCare } from "../api";
import { StudentsSection } from "../components/StudentsSection";
import CheckInScreen from "../screens/CheckInScreen";
import StudentScreen from "../screens/StudentScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "daniel" } } }) }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getStudents: jest.fn(), getStudent: jest.fn(), saveCheckin: jest.fn(), takeCare: jest.fn() }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const student = (over: Record<string, unknown>) => ({
  enrollmentId: "e-grace",
  name: "Grace Mwangi",
  programId: "p1",
  programName: "FFX Sep 2026",
  enrollmentStatus: "arrived",
  status: "on_track",
  lastCheckin: { weekOf: "2026-11-16", contact: "met", mood: "good", daysAgo: 7 },
  walkers: [{ userId: "daniel", name: "Daniel Pretorius" }],
  walkingWithMe: true,
  ...over,
});

const LIST = studentListSchema.parse({
  today: "2026-11-23",
  students: [
    student({ status: "needs_care" }),
    student({ enrollmentId: "e-sipho", name: "Sipho Dlamini", status: "no_checkin", lastCheckin: null, walkingWithMe: false, walkers: [] }),
    student({ enrollmentId: "e-joel", name: "Joel Andersson", walkingWithMe: true }),
    { broken: true },
  ],
});

const RECORD = studentRecordSchema.parse({
  today: "2026-11-23",
  student: student({ status: "needs_care" }),
  checkins: [
    {
      id: "c1",
      weekOf: "2026-11-16",
      contact: "met",
      mood: "okay",
      noteForStudent: "Proud of you",
      noteStaffOnly: "Mum unwell",
      needsCare: true,
      careTaken: null,
      author: { id: "ruth", name: "Ruth Malan" },
      mine: false,
    },
  ],
  journey: [
    { at: "2026-11-16T12:00:00Z", kind: "checkin", title: "Check-in · okay", detail: "Met · Ruth" },
    { at: "2026-09-07T10:00:00Z", kind: "arrived", title: "Arrived", detail: null },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  (getStudents as jest.Mock).mockResolvedValue(LIST);
  (getStudent as jest.Mock).mockResolvedValue(RECORD);
});

describe("Students list", () => {
  it("drops an odd row, shows status in words, and filters", async () => {
    expect(LIST.students).toHaveLength(3);
    await show(<StudentsSection onlyMine={false} />);
    await waitFor(() => expect(screen.getByText("Grace Mwangi")).toBeTruthy());
    expect(screen.getByLabelText("Grace Mwangi, Needs care")).toBeTruthy();
    expect(screen.getByText("No check-in")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("training-filter-no_checkin"));
    expect(screen.queryByText("Grace Mwangi")).toBeNull();
    expect(screen.getByText("Sipho Dlamini")).toBeTruthy();
  });

  it("My students shows only the people I walk with", async () => {
    await show(<StudentsSection onlyMine />);
    await waitFor(() => expect(screen.getByText("Grace Mwangi")).toBeTruthy());
    expect(screen.queryByText("Sipho Dlamini")).toBeNull();
    expect(screen.getByText("Joel Andersson")).toBeTruthy();
  });

  it("opens a student", async () => {
    await show(<StudentsSection onlyMine={false} />);
    await waitFor(() => screen.getByTestId("training-student-e-grace"));
    await fireEvent.press(screen.getByTestId("training-student-e-grace"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/training/student/[id]", params: { id: "e-grace" } });
  });

  it("every tappable has a role and a name", async () => {
    await show(<StudentsSection onlyMine={false} />);
    await waitFor(() => screen.getByText("Grace Mwangi"));
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});

describe("Student record", () => {
  it("shows the care band, journey, and both notes on the Check-ins tab", async () => {
    await show(<StudentScreen id="e-grace" />);
    await waitFor(() => expect(screen.getByTestId("training-care-band")).toBeTruthy());
    expect(screen.getByText(strings.record.careBand("Ruth Malan"))).toBeTruthy();
    expect(screen.getByTestId("training-journey")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("segment-checkins"));
    expect(screen.getByText("Proud of you")).toBeTruthy();
    expect(screen.getByText("Mum unwell")).toBeTruthy();
  });

  it("I'll take it calls the API and reloads", async () => {
    (takeCare as jest.Mock).mockResolvedValue(undefined);
    await show(<StudentScreen id="e-grace" />);
    await waitFor(() => screen.getByTestId("training-care-take"));
    const before = (getStudent as jest.Mock).mock.calls.length;
    await fireEvent.press(screen.getByTestId("training-care-take"));
    await waitFor(() => expect(takeCare).toHaveBeenCalledWith(expect.anything(), "c1"));
    await waitFor(() => expect((getStudent as jest.Mock).mock.calls.length).toBeGreaterThan(before));
  });

  it("Check in opens the form with the student's name", async () => {
    await show(<StudentScreen id="e-grace" />);
    await waitFor(() => screen.getByTestId("training-checkin-open"));
    await fireEvent.press(screen.getByTestId("training-checkin-open"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/training/checkin/[id]", params: { id: "e-grace", name: "Grace Mwangi" } });
  });
});

describe("Check-in form", () => {
  it("asks for a mood before saving", async () => {
    await show(<CheckInScreen id="e-grace" name="Grace Mwangi" />);
    expect(screen.getByText("Check in with Grace")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("training-checkin-save"));
    expect(screen.getByTestId("training-checkin-error")).toBeTruthy();
    expect(saveCheckin).not.toHaveBeenCalled();
  });

  it("couldn't reach hides the mood and saves without one", async () => {
    (saveCheckin as jest.Mock).mockResolvedValue(undefined);
    await show(<CheckInScreen id="e-grace" name="Grace Mwangi" />);
    await fireEvent.press(screen.getByLabelText("Couldn't reach"));
    expect(screen.queryByLabelText("Okay")).toBeNull();
    await fireEvent.press(screen.getByTestId("training-checkin-save"));
    await waitFor(() =>
      expect(saveCheckin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enrollmentId: "e-grace", contact: "no_reach", mood: null })),
    );
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("saves both notes and the care flag", async () => {
    (saveCheckin as jest.Mock).mockResolvedValue(undefined);
    await show(<CheckInScreen id="e-grace" name="Grace Mwangi" />);
    await fireEvent.press(screen.getByLabelText("Okay"));
    await fireEvent.changeText(screen.getByTestId("training-note-for-them"), "Proud of you");
    await fireEvent.changeText(screen.getByTestId("training-note-staff"), "Mum unwell");
    await fireEvent.press(screen.getByTestId("training-needs-care"));
    expect(screen.getByTestId("training-needs-care").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("training-checkin-save"));
    await waitFor(() =>
      expect(saveCheckin).toHaveBeenCalledWith(expect.anything(), {
        enrollmentId: "e-grace",
        contact: "met",
        mood: "okay",
        noteForStudent: "Proud of you",
        noteStaffOnly: "Mum unwell",
        needsCare: true,
      }),
    );
  });

  it("every tappable has a role and a name", async () => {
    await show(<CheckInScreen id="e-grace" name="Grace Mwangi" />);
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});
