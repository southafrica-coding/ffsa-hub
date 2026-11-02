import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { setSignOutReason } from "@/auth/sign-out-reason";
import { GENERIC_SIGN_IN_ERROR } from "@/auth/sign-in-logic";
import { supabase } from "@/lib/supabase";

import SignInScreen from "../(auth)/sign-in";

jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), signOut: jest.fn() } },
}));

const signIn = supabase.auth.signInWithPassword as jest.Mock;

async function fillAndSubmit(email = "jo@example.org", password = "wrong") {
  await fireEvent.changeText(screen.getByLabelText("Email"), email);
  await fireEvent.changeText(screen.getByLabelText("Password"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  signIn.mockReset();
  setSignOutReason(null);
});

describe("Sign-in screen", () => {
  it("validates inline without calling Supabase", async () => {
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in with the trimmed email", async () => {
    signIn.mockResolvedValue({ data: {}, error: null });
    await render(<SignInScreen />);
    await fillAndSubmit("  jo@example.org ", "correct horse");
    expect(signIn).toHaveBeenCalledWith({ email: "jo@example.org", password: "correct horse" });
    expect(screen.queryByTestId("sign-in-error")).toBeNull();
  });

  it("shows one generic message whatever Supabase says (no account enumeration)", async () => {
    signIn.mockResolvedValue({ data: {}, error: { status: 400, code: "email_not_confirmed", message: "Email not confirmed" } });
    await render(<SignInScreen />);
    await fillAndSubmit();
    expect(screen.getByTestId("sign-in-error")).toHaveTextContent(GENERIC_SIGN_IN_ERROR);
    expect(screen.queryByText(/not confirmed/i)).toBeNull();
  });

  it("starts a 30 s cooldown after 5 failures and counts down", async () => {
    jest.useFakeTimers();
    try {
      signIn.mockResolvedValue({ data: {}, error: { status: 400, message: "Invalid login credentials" } });
      await render(<SignInScreen />);
      for (let i = 0; i < 5; i++) await fillAndSubmit();
      expect(signIn).toHaveBeenCalledTimes(5);
      expect(screen.getByTestId("cooldown")).toHaveTextContent("Too many attempts. Please wait 30s and try again.");
      expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByTestId("cooldown")).toHaveTextContent(/wait 20s/);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(20_000);
      });
      expect(screen.queryByTestId("cooldown")).toBeNull();
      expect(screen.getByRole("button", { name: "Sign in" })).not.toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("opens the website's forgot-password page in the system browser", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole("link", { name: /Forgot password/ }));
    expect(open).toHaveBeenCalledWith("https://hub.example.test/forgot-password");
    open.mockRestore();
  });

  it("explains a deactivated account after a forced sign-out", async () => {
    setSignOutReason("deactivated");
    await render(<SignInScreen />);
    expect(screen.getByTestId("banner-deactivated")).toHaveTextContent(
      /This account has been deactivated\. Contact your administrator\./,
    );
  });

  it("says the session ended after a 401", async () => {
    setSignOutReason("unauthenticated");
    await render(<SignInScreen />);
    expect(screen.getByTestId("banner-session-ended")).toBeTruthy();
  });

  it("shows the password only on request", async () => {
    await render(<SignInScreen />);
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);
  });
});
