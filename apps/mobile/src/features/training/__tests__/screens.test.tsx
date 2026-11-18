import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";
import type { Me } from "@/lib/api";

import { makeMe } from "../../../../test/fixtures";
import { TrainingScreen } from "../screens/TrainingScreen";
import { strings } from "../strings";

let mockMe: { status: "loading" | "ready" | "error"; me: Me | null } = { status: "ready", me: null };
jest.mock("@/features/shell", () => ({
  ...jest.requireActual("@/features/shell"),
  useMe: () => ({ ...mockMe, error: null, refresh: jest.fn() }),
  openWebPage: jest.fn(async () => {}),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), navigate: jest.fn() }) }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "kim" } } }) }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../today", () => ({
  ...jest.requireActual("../today"),
  getToday: jest.fn(async () => ({ weekOf: "2026-11-23", isoWeek: "2026-W48", items: [], band: null, open: 0 })),
}));

const shell = jest.requireMock("@/features/shell") as { openWebPage: jest.Mock };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const NOW = new Date(2026, 10, 23, 9, 41);

const leader = () =>
  makeMe({
    profile: { firstName: "Kim", lastName: "Steyn", preferredName: null, avatarUrl: null, isActive: true },
    roles: [{ name: "program_leader", scopeType: "program", scopeId: "p1" }],
    permissions: [],
  });
const walker = () =>
  makeMe({
    profile: { firstName: "Daniel", lastName: "P", preferredName: null, avatarUrl: null, isActive: true },
    roles: [{ name: "staff", scopeType: null, scopeId: null }],
    permissions: [],
    training: { walkingWith: 5, programStaff: 0 },
  });

beforeEach(() => {
  shell.openWebPage.mockClear();
});

describe("TrainingScreen", () => {
  it("a school leader gets Today · Students · Applicants · Grades, Today selected", async () => {
    mockMe = { status: "ready", me: leader() };
    await show(<TrainingScreen now={NOW} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["Today", "Students", "Applicants", "Grades"]);
    expect(screen.getByTestId("training-section-today").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText("MON 23 NOV · YOUR SCHOOL")).toBeTruthy();
    expect(screen.getByText("Your week, Kim")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("training-today-clear")).toBeTruthy());
  });

  it("switching section changes the masthead and offers the website", async () => {
    mockMe = { status: "ready", me: leader() };
    await show(<TrainingScreen now={NOW} />);
    await fireEvent.press(screen.getByTestId("training-section-grades"));
    expect(screen.getByTestId("training-section-grades").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("training-empty-grades")).toBeTruthy();
    await fireEvent.press(screen.getByText(strings.openWeb));
    expect(shell.openWebPage).toHaveBeenCalledWith("/schools", expect.anything());
  });

  it("someone walking with students gets My students and no Applicants", async () => {
    mockMe = { status: "ready", me: walker() };
    await show(<TrainingScreen now={NOW} />);
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual(["Today", "My students", "Grades"]);
    expect(screen.getByText("MON 23 NOV · YOUR STUDENTS")).toBeTruthy();
  });

  it("reached without access (a deep link), it says who Training is for", async () => {
    mockMe = { status: "ready", me: makeMe() };
    await show(<TrainingScreen now={NOW} />);
    expect(screen.getByTestId("training-no-access")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("every tappable has a role and a name", async () => {
    mockMe = { status: "ready", me: leader() };
    await show(<TrainingScreen now={NOW} />);
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});
