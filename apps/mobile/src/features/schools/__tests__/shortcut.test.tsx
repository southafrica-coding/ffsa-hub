import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { Me } from "@/lib/api";

import { makeMe } from "../../../../test/fixtures";
import { loadSchoolsTies } from "../data";
import { enrolledFlagKey, useSchoolsAccess, useSchoolsShortcut } from "../shortcut";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));
let mockUserId = "u1";
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: mockUserId } } }) }));
let mockMe: Me | null = null;
let mockMeStatus: "loading" | "ready" | "error" = "ready";
jest.mock("@/features/shell", () => ({ useMe: () => ({ status: mockMeStatus, me: mockMe, error: null, refresh: jest.fn() }) }));
jest.mock("../data", () => ({ loadSchoolsTies: jest.fn() }));

const ties = loadSchoolsTies as jest.Mock;
const student = { enrolmentStatuses: ["arrived"], assignedStaff: false };
const leaver = { enrolmentStatuses: ["decided_to_leave"], assignedStaff: false };

function Probe() {
  const shown = useSchoolsShortcut();
  const access = useSchoolsAccess();
  return <Text testID="probe">{`${shown ? "shown" : "hidden"} ${access}`}</Text>;
}

const probe = () => screen.getByTestId("probe");

beforeEach(async () => {
  ties.mockReset();
  mockUserId = "u1";
  mockMe = makeMe({ roles: [], permissions: [] });
  mockMeStatus = "ready";
  await AsyncStorage.clear();
});

describe("useSchoolsShortcut / useSchoolsAccess", () => {
  it("loading: hidden while the answer is on its way (no flash in, then out)", async () => {
    ties.mockReturnValue(new Promise(() => undefined));
    await render(<Probe />);
    expect(probe()).toHaveTextContent("hidden checking");
  });

  it("shown once the person turns out to be an enrolled student, and remembered", async () => {
    ties.mockResolvedValue(student);
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("shown allowed"));
    expect(ties).toHaveBeenCalledWith("u1");
    await waitFor(async () => expect(await AsyncStorage.getItem(enrolledFlagKey("u1"))).toBe("1"));
  });

  it("hidden for someone whose only enrolment has ended (decided to leave)", async () => {
    ties.mockResolvedValue(leaver);
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("hidden notAllowed"));
    await waitFor(async () => expect(await AsyncStorage.getItem(enrolledFlagKey("u1"))).toBe("0"));
  });

  it("shown for assigned staff on an enrolment", async () => {
    ties.mockResolvedValue({ enrolmentStatuses: [], assignedStaff: true });
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("shown allowed"));
  });

  it("offline: the remembered answer is used", async () => {
    await AsyncStorage.setItem(enrolledFlagKey("u1"), "1");
    ties.mockRejectedValue(new Error("offline"));
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("shown allowed"));
  });

  it("offline with nothing remembered: hidden on Home, 'unknown' for the screens", async () => {
    ties.mockRejectedValue(new Error("offline"));
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("hidden unknown"));
  });

  it("a fresh answer beats the remembered one", async () => {
    await AsyncStorage.setItem(enrolledFlagKey("u1"), "1");
    ties.mockResolvedValue(leaver);
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("hidden notAllowed"));
    expect(await AsyncStorage.getItem(enrolledFlagKey("u1"))).toBe("0");
  });

  it("an old v1 '1' from the broader rule is ignored and cleared", async () => {
    await AsyncStorage.setItem("ffsa.schools.enrolled.v1:u1", "1");
    ties.mockReturnValue(new Promise(() => undefined));
    await render(<Probe />);
    expect(probe()).toHaveTextContent("hidden checking");
    await waitFor(async () => expect(await AsyncStorage.getItem("ffsa.schools.enrolled.v1:u1")).toBeNull());
  });

  it("the remembered answer is per person: someone else's '1' doesn't show it", async () => {
    await AsyncStorage.setItem(enrolledFlagKey("u1"), "1");
    mockUserId = "u2";
    ties.mockRejectedValue(new Error("offline"));
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("hidden unknown"));
    expect(ties).toHaveBeenCalledWith("u2");
  });

  it("waits for /api/me before saying no (they may hold the Training module)", async () => {
    mockMe = null;
    mockMeStatus = "loading";
    ties.mockResolvedValue(leaver);
    await render(<Probe />);
    await waitFor(() => expect(ties).toHaveBeenCalled());
    expect(probe()).toHaveTextContent("hidden checking");
  });

  it("Training-module holders see it without a query", async () => {
    mockMe = makeMe({ roles: [{ name: "program_leader", scopeType: null, scopeId: null }] });
    await render(<Probe />);
    expect(probe()).toHaveTextContent("shown allowed");
    expect(ties).not.toHaveBeenCalled();
  });

  it("a plain staff role alone is not school staff", async () => {
    mockMe = makeMe({ roles: [{ name: "staff", scopeType: null, scopeId: null }], permissions: [] });
    ties.mockResolvedValue({ enrolmentStatuses: [], assignedStaff: false });
    await render(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("hidden notAllowed"));
  });
});
