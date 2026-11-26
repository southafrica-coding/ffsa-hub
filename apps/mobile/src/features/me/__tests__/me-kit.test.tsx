// The Me screens' own building blocks (kit follow-ups): switch row, radio
// row, static row, bullets, info card and the pushed-page frame, in light and
// dark.

import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text as RNText } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NeedsYouBand, RadioRow, StaticRow, SwitchRow } from "@/components";
import { auditTappables } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";

import { BulletList, Group, GROUP_BLEED, InfoCard } from "../components/me-kit";
import { MePage } from "../components/MePage";

const mockRouter = { back: jest.fn(), push: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => ({
  ...jest.requireActual("@/theme/use-theme"),
  useTheme: () => jest.requireActual("@/theme/use-theme").themeFor(mockScheme),
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const WORDS = { on: "On", off: "Off" };
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

beforeEach(() => {
  mockScheme = "light";
  mockRouter.back.mockClear();
});

describe("SwitchRow", () => {
  it("the switch carries the name, the description as its hint, and the state; the words say On / Off too", async () => {
    const onChange = jest.fn();
    await show(<SwitchRow testID="sw" label="Prayer Room" description="Block-outs." value onChange={onChange} stateWords={WORDS} />);
    const sw = screen.getByRole("switch", { name: "Prayer Room" });
    expect(sw.props.accessibilityHint).toBe("Block-outs.");
    expect(sw.props.accessibilityState).toMatchObject({ checked: true, disabled: false, busy: false });
    // Not read twice: the text beside the switch is for the eye.
    expect(screen.queryByText("On")).toBeNull();
    expect(screen.getByText("On", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent(sw, "valueChange", false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("off, busy and disabled are all said", async () => {
    await show(<SwitchRow label="Events" value={false} onChange={() => {}} stateWords={WORDS} disabled busy />);
    expect(screen.getByText("Off", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Events" }).props.accessibilityState).toMatchObject({ checked: false, disabled: true, busy: true });
  });

  it.each(["light", "dark"] as const)("%s: the switch takes the themed colours", async (scheme) => {
    mockScheme = scheme;
    await show(<SwitchRow label="Events" value onChange={() => {}} stateWords={WORDS} />);
    expect(screen.getByRole("switch", { name: "Events" }).props).toMatchObject({ onTintColor: colors[scheme].primary });
  });
});

describe("RadioRow", () => {
  it.each(["light", "dark"] as const)("%s: a radio with its description as the hint; the mark is a filled ring", async (scheme) => {
    mockScheme = scheme;
    const onPress = jest.fn();
    await show(
      <>
        <RadioRow testID="r-a" label="Light" body="Always light." checked onPress={onPress} />
        <RadioRow testID="r-b" label="Dark" body="Always dark." checked={false} onPress={onPress} />
      </>,
    );
    const on = screen.getByRole("radio", { name: "Light" });
    expect(on.props.accessibilityState).toMatchObject({ checked: true, selected: true });
    expect(on.props.accessibilityHint).toBe("Always light.");
    const mark = screen.getByTestId("r-a-mark", { includeHiddenElements: true });
    expect(flat(mark.props.style)).toMatchObject({ borderWidth: 7, borderColor: colors[scheme].primary });
    expect(screen.queryByTestId("r-b-mark", { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Dark" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});

describe("StaticRow, BulletList, InfoCard, Group", () => {
  it("a static row is read as one line and keeps its action separately reachable", async () => {
    await show(
      <Group testID="group">
        <StaticRow
          title="Test Medical Aid"
          subtitle="Policy 123"
          note="Expires in 12 days (30 Nov 2026)"
          noteTone="attention"
          extra="Last confirmed 1 Jan 2026"
          accessibilityLabel="Test Medical Aid, Policy 123, expires in 12 days"
          trailing={<RNText accessibilityRole="button">Remove duplicate</RNText>}
        />
      </Group>,
    );
    expect(screen.getByLabelText("Test Medical Aid, Policy 123, expires in 12 days")).toBeTruthy();
    expect(screen.getByText("Expires in 12 days (30 Nov 2026)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove duplicate" })).toBeTruthy();
    // Inset lists sit at 16pt inside the 20pt gutter.
    expect(flat(screen.getByTestId("group").props.style)).toMatchObject({ marginHorizontal: GROUP_BLEED });
    expect(GROUP_BLEED).toBe(-4);
  });

  it("bullets are read one item at a time", async () => {
    await show(<BulletList items={["First thing.", "Second thing."]} />);
    expect(screen.getByLabelText("First thing.")).toBeTruthy();
    expect(screen.getByLabelText("Second thing.")).toBeTruthy();
  });

  it.each(["light", "dark"] as const)("%s: the info card is a bordered card, no shadow", async (scheme) => {
    mockScheme = scheme;
    await show(
      <InfoCard testID="card">
        <RNText>Shared record</RNText>
      </InfoCard>,
    );
    const style = flat(screen.getByTestId("card").props.style);
    expect(style).toMatchObject({ borderRadius: 8, borderColor: colors[scheme].rule, backgroundColor: colors[scheme].raised });
    expect(style.shadowColor).toBeUndefined();
    expect(style.elevation).toBeUndefined();
  });
});

describe("MePage", () => {
  it("names the screen as the heading, and the back button says where it goes", async () => {
    await show(
      <MePage title="Appearance">
        <RNText>Body</RNText>
      </MePage>,
    );
    expect(screen.getByRole("header", { name: "Appearance" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to Me" }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("a nested screen names its own parent", async () => {
    await show(
      <MePage title="Add child" backLabel="Household" tabBarHidden>
        <RNText>Body</RNText>
      </MePage>,
    );
    expect(screen.getByRole("button", { name: "Back to Household" })).toBeTruthy();
  });

  it("pull-to-refresh only when asked for, in the themed colours", async () => {
    mockScheme = "dark";
    const onRefresh = jest.fn();
    await show(
      <MePage title="Household" refreshing={false} onRefresh={onRefresh}>
        <RNText>Body</RNText>
      </MePage>,
    );
    type Host = { props: Record<string, unknown>; parent: Host | null };
    let rc: Record<string, unknown> | undefined;
    for (let n = screen.getByText("Body") as unknown as Host | null; n && !rc; n = n.parent) {
      rc = (n.props.refreshControl as { props: Record<string, unknown> } | undefined)?.props;
    }
    expect(rc).toMatchObject({ tintColor: colors.dark.text, progressBackgroundColor: colors.dark.surface });
  });

  it("warns if a screen ever shows two yellow bands", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementationOnce(() => {});
    await show(
      <MePage title="Health insurance">
        <NeedsYouBand eyebrow="Needs you" text="One" />
        <NeedsYouBand eyebrow="Needs you" text="Two" />
      </MePage>,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("at most one per screen"));
  });
});
