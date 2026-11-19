import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { palette } from "@/theme/tokens";

import { Banner, Button, Divider, LargeTitle, Screen, Text, TextField } from "..";

function flat(style: unknown) {
  return StyleSheet.flatten(style as never) ?? {};
}

describe("Text", () => {
  it("gives headings the header role and scales with the OS font size", async () => {
    await render(<Text variant="pageTitle">Sign in</Text>);
    const el = screen.getByRole("header", { name: "Sign in" });
    expect(el.props.allowFontScaling).toBe(true);
    expect(flat(el.props.style)).toMatchObject({ textTransform: "uppercase", color: palette.ink });
  });

  it("caps label size growth but never shrinks below 11", async () => {
    await render(<Text variant="monoLabel">Roles</Text>);
    const el = screen.getByText("Roles");
    expect(flat(el.props.style).fontSize).toBeGreaterThanOrEqual(11);
    expect(el.props.maxFontSizeMultiplier).toBe(2);
  });
});

describe("Button", () => {
  it("is an accessible 50pt button that fires onPress", async () => {
    const onPress = jest.fn();
    await render(<Button label="Sign in" onPress={onPress} />);
    const btn = screen.getByRole("button", { name: "Sign in" });
    expect(flat(btn.props.style).minHeight).toBe(50);
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("reports disabled and busy, and ignores presses while loading", async () => {
    const onPress = jest.fn();
    await render(<Button label="Sign in" onPress={onPress} loading />);
    const btn = screen.getByRole("button", { name: "Sign in" });
    expect(btn).toBeDisabled();
    expect(btn.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("uses an explicit accessibility label when given", async () => {
    await render(<Button label="Go" accessibilityLabel="Go to finance" />);
    expect(screen.getByRole("button", { name: "Go to finance" })).toBeTruthy();
  });
});

describe("TextField", () => {
  it("is labelled and shows an inline error", async () => {
    await render(<TextField label="Email" value="" onChangeText={() => {}} error="Enter your email address." />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your email address.");
  });

  it("toggles password visibility with an accessible button", async () => {
    await render(<TextField label="Password" value="pw" onChangeText={() => {}} secure />);
    const input = screen.getByLabelText("Password");
    expect(input.props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();
  });
});

describe("Banner", () => {
  it("renders the yellow needs-you band with black text", async () => {
    await render(
      <Screen>
        <Banner tone="needsYou" title="Needs you" testID="band">
          4 staff members are waiting on approval
        </Banner>
      </Screen>,
    );
    expect(flat(screen.getByTestId("band").props.style).backgroundColor).toBe(palette.yellow);
    expect(flat(screen.getByText("4 staff members are waiting on approval").props.style).color).toBe(palette.ink);
  });

  it("announces danger banners as alerts", async () => {
    await render(<Banner tone="danger">{"Couldn't load"}</Banner>);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps an action button reachable", async () => {
    const onPress = jest.fn();
    await render(<Banner tone="danger" action={<Button label="Try again" onPress={onPress} />}>Failed</Banner>);
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(onPress).toHaveBeenCalled();
  });

  it("warns in development when a screen has two yellow bands", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      <Screen>
        <Banner tone="needsYou">One</Banner>
        <Banner tone="needsYou">Two</Banner>
      </Screen>,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("at most one per screen"));
    warn.mockRestore();
  });

  it("doesn't warn for one band per screen", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      <>
        <Screen>
          <Banner tone="needsYou">One</Banner>
          <Banner tone="danger">Not yellow</Banner>
        </Screen>
        <Screen>
          <Banner tone="needsYou">Another screen</Banner>
        </Screen>
      </>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Divider and LargeTitle", () => {
  it("draws a hairline or a strong rule, hidden from screen readers", async () => {
    const { rerender } = await render(<Divider />);
    expect(flat(screen.getByTestId("divider", { includeHiddenElements: true }).props.style).height).toBe(1);
    await rerender(<Divider strong />);
    expect(flat(screen.getByTestId("divider", { includeHiddenElements: true }).props.style)).toMatchObject({
      height: 2,
      backgroundColor: palette.ink,
    });
  });

  it("LargeTitle: yellow tick, eyebrow and title", async () => {
    await render(<LargeTitle eyebrow="FFSA Hub · Home" title="Hello, Jo" />);
    // The tick is decoration: drawn, but hidden from screen readers.
    const tick = screen.getByTestId("large-title-tick", { includeHiddenElements: true });
    expect(flat(tick.props.style).backgroundColor).toBe(palette.yellow);
    expect(tick.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByRole("header", { name: "Hello, Jo" })).toBeTruthy();
  });
});
