import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { Me } from "@/lib/api";

import { makeMe } from "../../../../test/fixtures";
import { hasEnrolment } from "../data";
import { enrolledFlagKey, useSchoolsShortcut } from "../shortcut";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }) }));
let mockMe: Me | null = null;
jest.mock("@/features/shell", () => ({ useMe: () => ({ status: "ready", me: mockMe, error: null, refresh: jest.fn() }) }));
jest.mock("../data", () => ({ hasEnrolment: jest.fn() }));

const enrolled = hasEnrolment as jest.Mock;

function Probe() {
  return <Text testID="probe">{useSchoolsShortcut() ? "shown" : "hidden"}</Text>;
}

beforeEach(async () => {
  enrolled.mockReset();
  mockMe = makeMe();
  await AsyncStorage.clear();
});

describe("useSchoolsShortcut", () => {
  it("shown once the person turns out to have an enrolment, and remembered", async () => {
    enrolled.mockResolvedValue(true);
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("shown"));
    expect(enrolled).toHaveBeenCalledWith("u1");
    await waitFor(async () => expect(await AsyncStorage.getItem(enrolledFlagKey("u1"))).toBe("1"));
  });

  it("hidden with no enrolment and no Training module", async () => {
    enrolled.mockResolvedValue(false);
    await render(<Probe />);
    await waitFor(() => expect(enrolled).toHaveBeenCalled());
    expect(screen.getByTestId("probe")).toHaveTextContent("hidden");
  });

  it("offline: the remembered answer is used", async () => {
    await AsyncStorage.setItem(enrolledFlagKey("u1"), "1");
    enrolled.mockRejectedValue(new Error("offline"));
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("shown"));
  });

  it("Training-module holders see it without a query", async () => {
    mockMe = makeMe({ roles: [{ name: "program_leader", scopeType: null, scopeId: null }] });
    await render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("shown");
    expect(enrolled).not.toHaveBeenCalled();
  });
});
