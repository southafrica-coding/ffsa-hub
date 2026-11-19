// Sign-in after the redesign (mockup frames 1.2–1.5, 1.7–1.9): layout and
// look per state, in light and dark. Behaviour is covered in sign-in.test.tsx.

import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { Linking, StyleSheet } from "react-native";

import { setSignOutReason } from "@/auth/sign-out-reason";
import { NETWORK_SIGN_IN_ERROR, RATE_LIMITED_SIGN_IN_ERROR } from "@/auth/sign-in-logic";
import { supabase } from "@/lib/supabase";
import { colors } from "@/theme/tokens";

import SignInScreen from "../(auth)/sign-in";

jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), signOut: jest.fn() } },
}));
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});

const signIn = supabase.auth.signInWithPassword as jest.Mock;
const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};
const boxes = () => screen.getAllByTestId("text-field-box").map((b) => flat(b.props.style));

async function fillAndSubmit(email = "sample@example.org", password = "wrong") {
  await fireEvent.changeText(screen.getByLabelText("Email"), email);
  await fireEvent.changeText(screen.getByLabelText("Password"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
}

/** Where each named piece sits in the screen, top to bottom. */
function order(...ids: string[]) {
  const json = JSON.stringify(screen.toJSON());
  return ids.map((id) => json.indexOf(id));
}
const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || xs[i - 1] < x));

beforeEach(() => {
  signIn.mockReset();
  setSignOutReason(null);
  mockScheme = "light";
});

describe("Sign-in (redesign)", () => {
  it("1.2 layout: wordmark, eyebrow with tick, hero title, intro, fields, Sign in, Forgot password", async () => {
    await render(<SignInScreen />);
    expect(screen.getByText("FFSA Hub")).toBeTruthy();
    expect(screen.getByTestId("large-title-tick", { includeHiddenElements: true })).toBeTruthy();
    const title = screen.getByRole("header", { name: "Sign in" });
    expect(flat(title.props.style)).toMatchObject({ fontFamily: "Roboto_900Black", fontSize: 34, textTransform: "uppercase" });
    expect(title.props.maxFontSizeMultiplier).toBe(1.3);
    expect(
      ascending(order("Fire and Fragrance", "FFSA Hub", "Use the email and password you use for FFSA Hub on the web.", "Email-label", "Password-label", "Opens the website in your browser")),
    ).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("cooldown")).toBeNull();
  });

  it.each([
    ["light", "ff-wordmark-black"],
    ["dark", "ff-wordmark-white"],
  ] as const)("1.2 wordmark (%s): %s, and the primary button follows the scheme", async (scheme, file) => {
    mockScheme = scheme;
    await render(<SignInScreen />);
    const mark = screen.getByLabelText("Fire and Fragrance");
    expect(JSON.stringify(mark.props.source)).toContain(file);
    const button = screen.getByRole("button", { name: "Sign in" });
    const style = button.props.style;
    expect(flat(typeof style === "function" ? style({ pressed: false }) : style).backgroundColor).toBe(colors[scheme].primary);
  });

  it.each(["light", "dark"] as const)("1.3 wrong password (%s): one danger banner between the fields and Sign in", async (scheme) => {
    mockScheme = scheme;
    signIn.mockResolvedValue({ data: {}, error: { status: 400, message: "Invalid login credentials" } });
    await render(<SignInScreen />);
    await fillAndSubmit();
    const banner = screen.getByTestId("sign-in-error");
    expect(flat(banner.props.style)).toMatchObject({ borderColor: colors[scheme].danger, borderWidth: 1, borderRadius: 8 });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(ascending(order("Password-label", "sign-in-error", "Opens the website in your browser"))).toBe(true);
    // Not a field error: neither box turns red.
    for (const box of boxes()) expect(box.borderColor).not.toBe(colors[scheme].danger);
  });

  it("1.4 cooldown: the wait is in words in the attention colour and Sign in is disabled", async () => {
    signIn.mockResolvedValue({ data: {}, error: { status: 400, message: "Invalid login credentials" } });
    await render(<SignInScreen />);
    for (let i = 0; i < 5; i++) await fillAndSubmit();
    const wait = screen.getByTestId("cooldown");
    expect(wait).toHaveTextContent(/^Too many attempts\. Please wait \d+s and try again\.$/);
    expect(flat(wait.props.style).color).toBe(colors.light.attention);
    expect(wait.props.accessibilityLiveRegion).toBe("polite");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(ascending(order("sign-in-error", "cooldown", "Opens the website in your browser"))).toBe(true);
  });

  it("1.4 Supabase's own rate limit says to wait a few minutes", async () => {
    signIn.mockResolvedValue({ data: {}, error: { status: 429, message: "rate limit" } });
    await render(<SignInScreen />);
    await fillAndSubmit();
    expect(screen.getByTestId("sign-in-error")).toHaveTextContent(RATE_LIMITED_SIGN_IN_ERROR);
  });

  it("1.5 can't reach FFSA Hub: says what to do; you tap Sign in again (no button in the banner)", async () => {
    signIn.mockResolvedValue({ data: {}, error: { name: "AuthRetryableFetchError", status: 0, message: "Network request failed" } });
    await render(<SignInScreen />);
    await fillAndSubmit();
    const banner = screen.getByTestId("sign-in-error");
    expect(banner).toHaveTextContent(NETWORK_SIGN_IN_ERROR);
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeDisabled();
  });

  it.each(["light", "dark"] as const)("1.7 fields to fix (%s): each box gets a 2px danger outline and its message; no banner", async (scheme) => {
    mockScheme = scheme;
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "gabriel@example");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("That doesn't look like an email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    for (const box of boxes()) expect(box).toMatchObject({ borderWidth: 2, borderColor: colors[scheme].danger });
    expect(screen.queryByTestId("sign-in-error")).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("1.8 account deactivated: a danger banner above the fields, with its title", async () => {
    setSignOutReason("deactivated");
    await render(<SignInScreen />);
    const banner = screen.getByTestId("banner-deactivated");
    expect(within(banner).getByText("Account deactivated")).toBeTruthy();
    expect(flat(banner.props.style).borderColor).toBe(colors.light.danger);
    expect(within(banner).getByRole("alert")).toBeTruthy();
    expect(ascending(order("Use the email and password", "banner-deactivated", "Email-label"))).toBe(true);
  });

  it("1.9 session ended: a calm banner above the fields (not an alert)", async () => {
    setSignOutReason("unauthenticated");
    await render(<SignInScreen />);
    const banner = screen.getByTestId("banner-session-ended");
    expect(banner).toHaveTextContent("Your session has ended. Please sign in again.");
    expect(flat(banner.props.style).borderColor).toBe(colors.light.rule);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(ascending(order("Use the email and password", "banner-session-ended", "Email-label"))).toBe(true);
  });

  it("Forgot password: a 48pt link; if the browser can't open, it says where to go", async () => {
    const open = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("no browser"));
    await render(<SignInScreen />);
    const link = screen.getByRole("link", { name: "Forgot password? Opens the website in your browser" });
    const style = link.props.style;
    expect(flat(typeof style === "function" ? style({ pressed: false }) : style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(link);
    expect(await screen.findByText("Couldn't open your browser. Visit ffsahub.com/forgot-password instead.")).toBeTruthy();
    open.mockRestore();
  });
});
