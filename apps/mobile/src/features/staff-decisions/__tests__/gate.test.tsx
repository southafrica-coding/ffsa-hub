import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { Me } from "@/lib/api";

import { makeMe } from "../../../../test/fixtures";
import { useStaffDecisionsAccess } from "../access";
import { StaffDecisionsGate } from "../screens/StaffDecisionsGate";
import { strings } from "../strings";

const mockRouter = { navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
let mockMe: Me | null = null;
let mockMeStatus: "loading" | "ready" | "error" = "ready";
jest.mock("@/features/shell", () => ({
  ...jest.requireActual("@/features/shell/access"),
  useMe: () => ({ status: mockMeStatus, me: mockMe, error: null, refresh: jest.fn() }),
}));

const role = (name: string) => ({ name, scopeType: null, scopeId: null });
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const Inside = () => <Text testID="inside">inside</Text>;

beforeEach(() => {
  mockRouter.navigate.mockReset();
  mockMe = makeMe({ roles: [role("leadership_team")] });
  mockMeStatus = "ready";
});

// Home draws the shortcut row itself from this hook (app/__tests__/home*.test.tsx).
describe("useStaffDecisionsAccess (the Home shortcut gate)", () => {
  const Probe = () => <Text testID="access">{useStaffDecisionsAccess()}</Text>;

  it("Leadership Team: allowed", async () => {
    await render(<Probe />);
    expect(screen.getByTestId("access")).toHaveTextContent("allowed");
  });

  it.each(["admin", "super_admin", "staff"])("%s without leadership_team: not allowed", async (name) => {
    mockMe = makeMe({ roles: [role(name)] });
    await render(<Probe />);
    expect(screen.getByTestId("access")).toHaveTextContent("notAllowed");
  });

  it("checking while /api/me loads, unknown when it couldn't be read", async () => {
    mockMe = null;
    mockMeStatus = "loading";
    const view = await render(<Probe />);
    expect(screen.getByTestId("access")).toHaveTextContent("checking");
    await view.unmount();
    mockMeStatus = "error";
    await render(<Probe />);
    expect(screen.getByTestId("access")).toHaveTextContent("unknown");
  });
});

describe("Route gate", () => {
  it("Leadership Team: the screen", async () => {
    await show(
      <StaffDecisionsGate>
        <Inside />
      </StaffDecisionsGate>,
    );
    expect(screen.getByTestId("inside")).toBeTruthy();
  });

  it("an admin without leadership_team: the calm Leadership-Team-only screen", async () => {
    mockMe = makeMe({ roles: [role("admin")] });
    await show(
      <StaffDecisionsGate>
        <Inside />
      </StaffDecisionsGate>,
    );
    expect(screen.getByTestId("staff-decisions-not-allowed")).toBeTruthy();
    expect(screen.getByText(strings.gate.body)).toBeTruthy();
    expect(screen.queryByTestId("inside")).toBeNull();
  });

  it("checking: a labelled skeleton; /api/me unreadable: the screen (the server decides)", async () => {
    mockMe = null;
    mockMeStatus = "loading";
    const view = await show(
      <StaffDecisionsGate>
        <Inside />
      </StaffDecisionsGate>,
    );
    expect(screen.getByLabelText(strings.gate.checking)).toBeTruthy();
    await view.unmount();
    mockMeStatus = "error";
    await show(
      <StaffDecisionsGate>
        <Inside />
      </StaffDecisionsGate>,
    );
    expect(screen.getByTestId("inside")).toBeTruthy();
  });
});
