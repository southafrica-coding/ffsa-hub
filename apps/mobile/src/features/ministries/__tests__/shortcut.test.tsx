import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { Me } from "@/lib/api";

import { makeMe } from "../../../../test/fixtures";
import { getMinistriesAccess } from "../api";
import { MinistriesHomeShortcut } from "../HomeShortcut";
import { accessFlagKey, useMinistriesAccess, useMinistriesShortcut } from "../shortcut";

const mockRouter = { navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
let mockUserId = "u1";
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: mockUserId } } }) }));
let mockMe: Me | null = null;
let mockMeStatus: "loading" | "ready" | "error" = "ready";
jest.mock("@/features/shell", () => ({
  ...jest.requireActual("@/features/shell/ui"),
  useMe: () => ({ status: mockMeStatus, me: mockMe, error: null, refresh: jest.fn() }),
}));
jest.mock("../api", () => ({ getMinistriesAccess: jest.fn() }));

const probe = getMinistriesAccess as jest.Mock;
const role = (name: string) => ({ name, scopeType: null, scopeId: null });

function Probe() {
  const shown = useMinistriesShortcut();
  const access = useMinistriesAccess();
  return <Text testID="probe">{`${shown ? "shown" : "hidden"} ${access}`}</Text>;
}
const out = () => screen.getByTestId("probe");

beforeEach(async () => {
  probe.mockReset();
  mockRouter.navigate.mockReset();
  mockUserId = "u1";
  mockMe = makeMe({ roles: [role("staff")], permissions: [] });
  mockMeStatus = "ready";
  await AsyncStorage.clear();
});

describe("useMinistriesShortcut / useMinistriesAccess", () => {
  it("loading: hidden while the probe is on its way", async () => {
    probe.mockReturnValue(new Promise(() => undefined));
    await render(<Probe />);
    expect(out()).toHaveTextContent("hidden checking");
  });

  it("admins and Leadership Team: shown at once, no probe", async () => {
    for (const name of ["admin", "leadership_team"]) {
      mockMe = makeMe({ roles: [role(name)] });
      const view = await render(<Probe />);
      expect(out()).toHaveTextContent("shown allowed");
      await view.unmount();
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("a ministry leader: shown once the server says yes, and remembered", async () => {
    probe.mockResolvedValue(true);
    await render(<Probe />);
    await waitFor(() => expect(out()).toHaveTextContent("shown allowed"));
    await waitFor(async () => expect(await AsyncStorage.getItem(accessFlagKey("u1"))).toBe("1"));
  });

  it("everyone else: hidden (permission denied), and remembered", async () => {
    probe.mockResolvedValue(false);
    await render(<Probe />);
    await waitFor(() => expect(out()).toHaveTextContent("hidden notAllowed"));
    await waitFor(async () => expect(await AsyncStorage.getItem(accessFlagKey("u1"))).toBe("0"));
  });

  it("offline: the remembered answer is used", async () => {
    await AsyncStorage.setItem(accessFlagKey("u1"), "1");
    probe.mockRejectedValue(new Error("offline"));
    await render(<Probe />);
    await waitFor(() => expect(out()).toHaveTextContent("shown allowed"));
  });

  it("offline with nothing remembered: unknown (the screens handle it), shortcut hidden", async () => {
    probe.mockRejectedValue(new Error("offline"));
    await render(<Probe />);
    await waitFor(() => expect(out()).toHaveTextContent("hidden unknown"));
  });

  it("never shares one person's answer with another on the same phone", async () => {
    await AsyncStorage.setItem(accessFlagKey("someone-else"), "1");
    probe.mockReturnValue(new Promise(() => undefined));
    await render(<Probe />);
    expect(out()).toHaveTextContent("hidden checking");
  });
});

describe("Home shortcut row", () => {
  it("renders nothing until allowed, then opens /ministries", async () => {
    probe.mockResolvedValue(true);
    await render(<MinistriesHomeShortcut />);
    const row = await screen.findByRole("button", { name: "Ministries" });
    await fireEvent.press(row);
    expect(mockRouter.navigate).toHaveBeenCalledWith("/ministries");
  });

  it("stays hidden for someone without access", async () => {
    probe.mockResolvedValue(false);
    await render(<MinistriesHomeShortcut />);
    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(screen.queryByTestId("shortcut-ministries")).toBeNull();
  });
});
