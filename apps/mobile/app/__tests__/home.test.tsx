import { fireEvent, render, screen } from "@testing-library/react-native";

import { ApiError, meSchema } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import HomeScreen from "../(app)/index";

// GET /api/me is mocked: the real endpoint ships in web PR 1.
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: jest.fn().mockResolvedValue({ error: null }) } } }));

const mockFetch = apiFetch as unknown as jest.Mock;

const ME = meSchema.parse({
  user: { id: "u1", email: "jo@example.org" },
  profile: { firstName: "Johanna", lastName: "Smit", preferredName: "Jo", avatarUrl: null, isActive: true },
  roles: [
    { name: "staff", scopeType: null, scopeId: null },
    { name: "team_leader", scopeType: "outreach_team", scopeId: "t1" },
  ],
  permissions: [
    { key: "a", scopeType: null, scopeId: null, source: "role" },
    { key: "b", scopeType: null, scopeId: null, source: "role" },
    { key: "c", scopeType: null, scopeId: null, source: "direct" },
  ],
  serverTime: "2026-11-02T08:00:00.000Z",
});

beforeEach(() => {
  mockFetch.mockReset();
  (supabase.auth.signOut as jest.Mock).mockClear();
});

describe("Home (placeholder)", () => {
  it("calls GET /api/me and shows greeting, roles, permission count and server time", async () => {
    mockFetch.mockResolvedValue(ME);
    await render(<HomeScreen />);
    expect(await screen.findByRole("header", { name: "Hello, Jo" })).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ schema: meSchema }));
    expect(screen.getByLabelText("3 permissions")).toHaveTextContent("3");
    expect(screen.getByText(/staff/)).toBeTruthy();
    expect(screen.getByText(/team_leader/)).toBeTruthy();
    expect(screen.queryByText("Not reported")).toBeNull();
  });

  it("shows the yellow band exactly once", async () => {
    mockFetch.mockResolvedValue(ME);
    await render(<HomeScreen />);
    await screen.findByRole("header", { name: "Hello, Jo" });
    expect(screen.getAllByTestId("needs-you")).toHaveLength(1);
    expect(screen.getByText("Home is a placeholder: real screens come in Phase 1.")).toBeTruthy();
  });

  it("shows an error with a working retry", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again."));
    mockFetch.mockResolvedValueOnce(ME);
    await render(<HomeScreen />);
    expect(await screen.findByText("Couldn't reach FFSA Hub. Check your connection and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("header", { name: "Hello, Jo" })).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("shows no error when the API has signed the user out (the auth gate takes over)", async () => {
    mockFetch.mockRejectedValue(new ApiError("deactivated", "x", 403));
    await render(<HomeScreen />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Couldn't load your account")).toBeNull();
  });

  it("signs out on this device only", async () => {
    mockFetch.mockResolvedValue(ME);
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
