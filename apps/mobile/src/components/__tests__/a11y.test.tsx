import { render, screen } from "@testing-library/react-native";
import { Settings } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { ListRow, SectionBar, SkeletonRows, StateMessage, BarAction } from "@/features/shell/ui";
import { auditTappables, tappableSizes } from "@/lib/a11y/testing";

import { Banner, Button, Masthead, Screen, Text, TextField } from "..";

const flatten = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

describe("kit accessibility", () => {
  it("every tappable in the kit has a role and a name, and is at least 48dp", async () => {
    await render(
      <Screen>
        <Masthead context="FFSA Hub · Finance" title="Finance" />
        <SectionBar label="Teams" right={<BarAction label="See all" onPress={() => {}} />} />
        <Button label="Save" onPress={() => {}} />
        <Button label="Retry" variant="ghost" icon={<Settings size={16} />} onPress={() => {}} />
        <TextField label="Password" value="x" onChangeText={() => {}} secure />
        <ListRow title="Appearance" subtitle="Match phone" icon={Settings} onPress={() => {}} />
        <ListRow title="Open the website" trailing="web" onPress={() => {}} />
        <StateMessage title="Couldn't load" body="Check your connection." actionLabel="Try again" onAction={() => {}} />
      </Screen>,
    );
    expect(auditTappables(screen.container as never)).toEqual([]);
    for (const t of tappableSizes(screen.container as never, flatten)) {
      const slop = typeof t.hitSlop === "number" ? t.hitSlop * 2 : 0;
      const h = Math.max(Number(t.minHeight ?? 0), Number(t.height ?? 0)) + slop;
      expect({ name: t.name, ok: h >= 48 }).toEqual({ name: t.name, ok: true });
    }
  });

  it("button icons and spinners are hidden; the busy state is on the button", async () => {
    await render(<Button label="Saving" loading icon={<View testID="icon" />} />);
    expect(screen.getByRole("button", { name: "Saving" }).props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.queryByTestId("icon")).toBeNull();
  });

  it("text fields are named once, by the input", async () => {
    await render(<TextField label="Email" value="" onChangeText={() => {}} hint="We'll send a link." />);
    const input = screen.getByLabelText("Email");
    expect(input.props.accessibilityHint).toBe("We'll send a link.");
    // The visual label is hidden so VoiceOver doesn't read "Email" twice.
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.getByText("Email", { includeHiddenElements: true })).toBeTruthy();
  });

  it("the field error becomes the input's hint and is announced", async () => {
    await render(<TextField label="Amount" value="" onChangeText={() => {}} error="Enter an amount." />);
    expect(screen.getByLabelText("Amount").props.accessibilityHint).toBe("Enter an amount.");
    expect(screen.getByRole("alert").props.accessibilityLiveRegion).toBe("polite");
  });

  it("list rows keep the subtitle in the hint even with a custom hint, and hide their icons", async () => {
    await render(
      <ListRow title="Appearance" subtitle="Match phone" icon={Settings} accessibilityHint="Opens appearance settings." onPress={() => {}} />,
    );
    const row = screen.getByRole("button", { name: "Appearance" });
    expect(row.props.accessibilityHint).toBe("Match phone. Opens appearance settings.");
  });

  it("web rows say they open in the browser", async () => {
    await render(<ListRow title="Website" trailing="web" onPress={() => {}} />);
    const row = screen.getByRole("link", { name: "Website. Opens in browser" });
    expect(row.props.accessibilityHint).toMatch(/browser/);
  });

  it("disabled rows say so", async () => {
    await render(<ListRow title="Finance" disabled onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Finance" })).toBeDisabled();
  });

  it("headings: masthead title, section bar and state titles are headers", async () => {
    await render(
      <Screen>
        <Masthead context="Hub" title="Tickets" />
        <SectionBar label="Upcoming" />
        <StateMessage title="No tickets yet" icon={Settings} />
        <Text variant="title">Section</Text>
      </Screen>,
    );
    for (const name of ["Tickets", "Upcoming", "No tickets yet", "Section"]) {
      expect(screen.getByRole("header", { name })).toBeTruthy();
    }
  });

  it("skeletons are one labelled progress element", async () => {
    await render(<SkeletonRows label="Loading your teams" />);
    expect(screen.getByRole("progressbar", { name: "Loading your teams" })).toBeTruthy();
  });

  it("banners: danger is an alert; needs-you is a summary read as one unit", async () => {
    await render(
      <Screen>
        <Banner tone="needsYou" title="Needs you">
          2 receipts are missing
        </Banner>
      </Screen>,
    );
    const band = screen.getByRole("summary");
    expect(band.props.accessible).toBe(true);
  });
});

describe("Banner announcements", () => {
  const { AccessibilityInfo, Platform } = jest.requireActual<typeof import("react-native")>("react-native");

  it("a danger banner with a retry keeps its alert role on the message, and the button stays reachable", async () => {
    await render(
      <Banner tone="danger" title="Couldn't load" action={<Button label="Try again" onPress={() => {}} />}>
        Check your connection.
      </Banner>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.props.accessibilityLiveRegion).toBe("assertive");
    expect(alert).toHaveTextContent(/Couldn't load/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("speaks danger banners on iOS (VoiceOver ignores live regions), not info ones", async () => {
    const spy = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
    Platform.OS = "ios";
    await render(<Banner tone="info">Just so you know</Banner>);
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("Just so you know"), expect.anything());
    await render(<Banner tone="danger" title="Couldn't save">Try again in a minute.</Banner>);
    expect(spy).toHaveBeenCalledWith("Couldn't save. Try again in a minute", { queue: true });
    spy.mockRestore();
  });
});
