// The kit pieces promoted in R4 (polish and QA), in light and dark: section
// title with a count, PushedPage, GroupRow / InfoRow / StatusLine, load
// states, rows, ChoiceSegments, and the new props on NavBar, Sheet,
// NeedsYouBand, SectionHeader and Banner.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { CircleCheck, Wallet } from "lucide-react-native";
import { StyleSheet, Text as RNText } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactElement } from "react";

import { auditTappables } from "@/lib/a11y/testing";
import { palette, space, touch } from "@/theme/tokens";

import {
  Banner,
  BLEED,
  Bleed,
  Button,
  ChoiceSegments,
  FadeIn,
  Freshness,
  GroupRow,
  IconTile,
  InfoRow,
  ListGroup,
  LoadError,
  LoadFailed,
  NavBar,
  NeedsYouBand,
  PushedPage,
  RadioRow,
  SectionHeader,
  SectionTitle,
  Sheet,
  StaleNote,
  StaticRow,
  StatusLine,
  SwitchRow,
} from "..";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
jest.mock("@/lib/saved-at", () => ({ formatSavedAt: () => "09:05" }));

const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const inSafeArea = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

beforeEach(() => {
  mockScheme = "light";
});

describe.each(["light", "dark"] as const)("R4 kit (%s)", (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it("SectionTitle reads the title and its count as one heading", async () => {
    await render(<SectionTitle title="Outreach teams" meta="3 teams" />);
    expect(screen.getByRole("header", { name: "Outreach teams, 3 teams" })).toBeTruthy();
    expect(screen.getByText("3 teams")).toBeTruthy();
  });

  it("SectionTitle takes a number and a spoken label", async () => {
    await render(<SectionTitle title="Wed 18 Nov" meta={2} accessibilityLabel="Wednesday 18 November, 2 sets" tight />);
    expect(screen.getByRole("header", { name: "Wednesday 18 November, 2 sets" })).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("Bleed pulls cards from the 20pt gutter to the 16pt edge", async () => {
    await render(
      <Bleed>
        <RNText testID="inside">x</RNText>
      </Bleed>,
    );
    expect(BLEED).toBe(space.inset - space.gutter);
    expect(flat(screen.getByTestId("inside").parent?.props.style).marginHorizontal).toBe(BLEED);
  });

  it("PushedPage: back names the parent, the title is the heading, pull to refresh", async () => {
    const onBack = jest.fn();
    await inSafeArea(
      <PushedPage back={{ label: "Me", onPress: onBack }} title="Appearance" refreshing={false} onRefresh={() => {}}>
        <RNText>Body</RNText>
      </PushedPage>,
    );
    expect(screen.getByRole("header", { name: "Appearance" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to Me" }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("GroupRow is a button with a chevron when it opens something, a plain element when it only tells", async () => {
    const onPress = jest.fn();
    await render(
      <ListGroup>
        <GroupRow accessibilityLabel="Nepal team. R 3 000 left" onPress={onPress} lead={<IconTile icon={Wallet} />} testID="open">
          <RNText>Nepal team</RNText>
        </GroupRow>
        <GroupRow accessibilityLabel="Jo, leader" testID="static">
          <RNText>Jo</RNText>
        </GroupRow>
      </ListGroup>,
    );
    const row = screen.getByRole("button", { name: "Nepal team. R 3 000 left" });
    expect(flat(row.props.style).minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId("static").props.accessibilityRole).toBeUndefined();
    expect(screen.getByLabelText("Jo, leader")).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("InfoRow reads as one line; StatusLine is icon + words", async () => {
    await render(
      <>
        <InfoRow icon={Wallet} title="Finance office" subtitle="Approvals happen on the website" meta="Soon" />
        <StatusLine icon={CircleCheck} tone="positive">
          All receipts sent
        </StatusLine>
      </>,
    );
    expect(screen.getByLabelText("Finance office. Approvals happen on the website. Soon")).toBeTruthy();
    expect(screen.getByText("All receipts sent")).toBeTruthy();
  });

  it("LoadError and LoadFailed say what happened and offer Try again; StaleNote is calm", async () => {
    const retry = jest.fn();
    await render(
      <>
        <LoadError title="Couldn't load your teams" message="Check your signal." onRetry={retry} />
        <LoadFailed title="Couldn't load your bookings" message="Pull down to try again." onRetry={retry} />
        <StaleNote message="Couldn't refresh. Showing what was saved at 09:05." onRetry={retry} testID="stale" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't load your teams/);
    expect(screen.getByTestId("load-failed")).toBeTruthy();
    const tries = screen.getAllByRole("button", { name: "Try again" });
    expect(tries).toHaveLength(3);
    for (const t of tries) await fireEvent.press(t);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it("Freshness: nothing when fresh, 'Last updated' for a saved copy, the offline note when a refresh failed", async () => {
    const retry = jest.fn();
    const view = await render(<Freshness state={{ status: "ready", staleSince: null, refreshError: null }} onRetry={retry} />);
    expect(screen.toJSON()).toBeNull();
    await view.rerender(<Freshness state={{ status: "ready", staleSince: 1, refreshError: null }} onRetry={retry} />);
    expect(screen.getByTestId("last-updated")).toHaveTextContent("Last updated 09:05");
    await view.rerender(
      <Freshness state={{ status: "ready", staleSince: 1, refreshError: "offline" }} onRetry={retry} bleed>
        <RNText>Check-ins need a signal.</RNText>
      </Freshness>,
    );
    expect(screen.getByText("Couldn't refresh. Showing what was saved at 09:05.")).toBeTruthy();
    expect(screen.getByText("Check-ins need a signal.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });

  it("SwitchRow, RadioRow (leading and trailing) and StaticRow keep their controls reachable", async () => {
    const onSwitch = jest.fn();
    const onRadio = jest.fn();
    await render(
      <ListGroup>
        <SwitchRow label="Prayer room" description="Your sets" value onChange={onSwitch} stateWords={{ on: "On", off: "Off" }} testID="sw" />
        <RadioRow label="Match phone" body="Light or dark" checked onPress={onRadio} testID="r1" />
        <RadioRow mark="leading" checked={false} accessibilityLabel="Main hall" onPress={onRadio} testID="r2">
          <RNText>Main hall</RNText>
        </RadioRow>
        <StaticRow title="Policy 123" accessibilityLabel="Policy 123" trailing={<Button label="Remove duplicate" size="small" variant="text" onPress={() => {}} />} />
      </ListGroup>,
    );
    expect(screen.getByRole("radio", { name: "Match phone" }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("r1-mark", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Main hall" }));
    expect(onRadio).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove duplicate" })).toBeTruthy();
    expect(screen.getByText("On", { includeHiddenElements: true })).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("ChoiceSegments starts with nothing chosen, is a radio group, and marks the choice with bold + yellow underline", async () => {
    const onChange = jest.fn();
    const options = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ] as const;
    const view = await render(<ChoiceSegments label="Accepted?" hint="Pick one" options={options} value={null} onChange={onChange} />);
    expect(screen.getByRole("header", { name: "Accepted?" })).toBeTruthy();
    expect(screen.getByText("Pick one")).toBeTruthy();
    for (const name of ["Yes", "No"]) {
      const r = screen.getByRole("radio", { name });
      expect(r.props.accessibilityState).toMatchObject({ checked: false });
      expect(flat(r.props.style).minHeight).toBeGreaterThanOrEqual(touch.floor);
    }
    await fireEvent.press(screen.getByRole("radio", { name: "No" }));
    expect(onChange).toHaveBeenCalledWith("no");
    await view.rerender(<ChoiceSegments label="Accepted?" options={options} value="no" onChange={onChange} />);
    const chosen = screen.getByTestId("choice-no");
    expect(chosen.props.accessibilityState).toMatchObject({ checked: true });
    expect(flat(chosen.props.style)).toMatchObject({ borderBottomWidth: 2, borderBottomColor: palette.yellow });
  });

  it("NavBar takes a leading control instead of Back (Cancel, the volunteer door's Done)", async () => {
    const onDone = jest.fn();
    await render(<NavBar left={<Button label="Done" variant="ghost" size="small" onPress={onDone} />} right={<RNText>R</RNText>} />);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("Sheet: the subtitle can have its own spoken form", async () => {
    await inSafeArea(
      <Sheet visible title="Devo set" subtitle="Wed 18 Nov · 08:00–09:30" subtitleAccessibilityLabel="Wednesday 18 November, 8 to 9:30 am" onClose={() => {}}>
        <RNText>Lineup</RNText>
      </Sheet>,
    );
    expect(screen.getByText("Wed 18 Nov · 08:00–09:30").props.accessibilityLabel).toBe("Wednesday 18 November, 8 to 9:30 am");
  });

  it("NeedsYouBand: second line, a spoken action label and a hint", async () => {
    const onAction = jest.fn();
    await render(
      <NeedsYouBand
        eyebrow="Needs you"
        text="2 things need you"
        detail="New booking request"
        actionLabel="Open"
        actionAccessibilityLabel="Open: New booking request"
        actionAccessibilityHint="Opens the request"
        onAction={onAction}
      />,
    );
    expect(screen.getByRole("summary")).toHaveProp("accessibilityLabel", "Needs you. 2 things need you. New booking request");
    const button = screen.getByRole("button", { name: "Open: New booking request" });
    expect(button.props.accessibilityHint).toBe("Opens the request");
    await fireEvent.press(button);
    expect(onAction).toHaveBeenCalled();
  });

  it("SectionHeader: the action has its own spoken label and testID; the title can be spoken differently", async () => {
    await render(
      <SectionHeader
        title="Wed 18 Nov"
        accessibilityLabel="Wednesday 18 November"
        actionLabel="Mark all read"
        actionAccessibilityLabel="Mark all 3 as read"
        actionTestID="mark-all"
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole("header", { name: "Wednesday 18 November" })).toBeTruthy();
    expect(screen.getByTestId("mark-all")).toHaveProp("accessibilityLabel", "Mark all 3 as read");
  });

  it("Banner: a busy inline action shows a spinner and can't be pressed twice", async () => {
    const onAction = jest.fn();
    await render(
      <Banner tone="queued" title="2 scans waiting" actionLabel="Send now" onAction={onAction} actionBusy>
        Saved on this phone, not yet sent.
      </Banner>,
    );
    const button = screen.getByRole("button", { name: "Send now" });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId("banner-action-busy")).toBeTruthy();
    await fireEvent.press(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("FadeIn renders its content (the fade itself needs a device; Reduce Motion skips it)", async () => {
    await render(
      <FadeIn testID="fade">
        <RNText>Loaded</RNText>
      </FadeIn>,
    );
    expect(screen.getByTestId("fade")).toHaveTextContent("Loaded");
  });
});
