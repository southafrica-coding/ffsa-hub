import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getTabBadge } from "@/features/shell";
import { auditTappables } from "@/lib/a11y/testing";

import { TodaySection } from "../components/TodaySection";
import { getToday, setTodayDone, todaySchema, withDone } from "../today";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "kim" } } }) }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("../today", () => ({ ...jest.requireActual("../today"), getToday: jest.fn(), setTodayDone: jest.fn() }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const TODAY = todaySchema.parse({
  weekOf: "2026-11-23",
  isoWeek: "2026-W48",
  items: [
    { key: "care:c1", kind: "care", severity: 1, title: "Ruth flagged Joel", meta: "Check-in · needs care", count: null, target: { type: "student", enrollmentId: "e-joel" }, done: false },
    { key: "checkins:p1:2026-W48", kind: "checkins", severity: 2, title: "3 students haven't had a check-in for 2 weeks", meta: "FFX Sep 2026", count: 3, target: { type: "students", filter: "no_checkin" }, done: false },
    { key: "fees:p1:2026-W48", kind: "fees", severity: 3, title: "Chase 4 fee balances", meta: "R 18,400 overdue · FFX Sep 2026", count: 4, target: { type: "web", path: "/schools" }, done: false },
    { nonsense: true },
  ],
  band: "care:c1",
  open: 3,
});

beforeEach(() => {
  jest.clearAllMocks();
  (getToday as jest.Mock).mockResolvedValue(TODAY);
  (setTodayDone as jest.Mock).mockResolvedValue(undefined);
});

describe("today contract", () => {
  it("drops an odd item and ticks locally: re-sorts, moves the band, recounts", () => {
    expect(TODAY.items).toHaveLength(3);
    const next = withDone(TODAY, "care:c1", true);
    expect(next.items.map((i) => i.key)).toEqual(["checkins:p1:2026-W48", "fees:p1:2026-W48", "care:c1"]);
    expect(next.band).toBe("checkins:p1:2026-W48");
    expect(next.open).toBe(2);
  });
});

describe("TodaySection", () => {
  it("shows the most urgent item as the one band and sets the tab badge", async () => {
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId("training-today-band")).toBeTruthy());
    expect(screen.getByText("Ruth flagged Joel · Check-in · needs care")).toBeTruthy();
    expect(screen.getAllByTestId("training-today-band")).toHaveLength(1);
    expect(getTabBadge("training")).toBe(3);
  });

  it("each line opens the screen that does the work", async () => {
    const onOpenStudents = jest.fn();
    await show(<TodaySection onOpenStudents={onOpenStudents} />);
    await waitFor(() => screen.getByTestId("training-today-open-care:c1"));
    await fireEvent.press(screen.getByTestId("training-today-open-care:c1"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/training/student/[id]", params: { id: "e-joel" } });
    await fireEvent.press(screen.getByTestId("training-today-open-checkins:p1:2026-W48"));
    expect(onOpenStudents).toHaveBeenCalledWith("no_checkin");
  });

  it("ticking saves, moves the band on, and lowers the badge", async () => {
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => screen.getByTestId("training-today-tick-care:c1"));
    await fireEvent.press(screen.getByTestId("training-today-tick-care:c1"));
    expect(setTodayDone).toHaveBeenCalledWith(expect.anything(), "care:c1", true);
    await waitFor(() => expect(screen.getByText("3 students haven't had a check-in for 2 weeks · FFX Sep 2026")).toBeTruthy());
    expect(screen.getByTestId("training-today-tick-care:c1").props.accessibilityState).toMatchObject({ checked: true });
    expect(getTabBadge("training")).toBe(2);
  });

  it("a failed tick puts the line back", async () => {
    (setTodayDone as jest.Mock).mockRejectedValue(new Error("offline"));
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => screen.getByTestId("training-today-tick-care:c1"));
    await fireEvent.press(screen.getByTestId("training-today-tick-care:c1"));
    await waitFor(() => expect(screen.getByTestId("training-today-tick-care:c1").props.accessibilityState).toMatchObject({ checked: false }));
  });

  it("an empty week says so calmly, with no band", async () => {
    (getToday as jest.Mock).mockResolvedValue({ ...TODAY, items: [], band: null, open: 0 });
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId("training-today-clear")).toBeTruthy());
    expect(screen.queryByTestId("training-today-band")).toBeNull();
  });

  it("every tappable has a role and a name", async () => {
    await show(<TodaySection onOpenStudents={jest.fn()} />);
    await waitFor(() => screen.getByTestId("training-today-band"));
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});
