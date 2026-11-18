import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Wallet } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors, palette } from "@/theme/tokens";

import {
  Banner,
  Button,
  EmptyState,
  LargeTitle,
  LargeTitleScrollView,
  ListGroup,
  ListRow,
  MoneyText,
  NeedsYouBand,
  PhotoSlot,
  Screen,
  SectionHeader,
  SegmentedControl,
  Sheet,
  Skeleton,
  SkeletonList,
  StatusChip,
  TextField,
  Toggle,
  WebHint,
} from "..";

// Every kit component: renders, has a VoiceOver label, follows dark mode,
// and shows its disabled / error variants.

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
let mockReduceMotion = false;
jest.mock("@/lib/a11y", () => ({
  ...jest.requireActual("@/lib/a11y"),
  useReduceMotion: () => mockReduceMotion,
}));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => {}) }));

const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};
const styleOf = (el: { props: { style?: unknown } }, pressed = false) => {
  const s = el.props.style;
  return flat(typeof s === "function" ? s({ pressed }) : s);
};
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const withInsets = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;

beforeEach(() => {
  mockScheme = "light";
  mockReduceMotion = false;
});

describe("LargeTitle", () => {
  it("draws the tick, the caps eyebrow and a Roboto 900 caps title read as a header", async () => {
    await render(<LargeTitle eyebrow="FFSA Hub · Home" title="My finance" />);
    const title = screen.getByRole("header", { name: "My finance" });
    expect(flat(title.props.style)).toMatchObject({ fontFamily: "Roboto_900Black", fontSize: 28, textTransform: "uppercase" });
    expect(title.props.maxFontSizeMultiplier).toBe(1.4);
    expect(flat(screen.getByText("FFSA Hub · Home").props.style)).toMatchObject({ textTransform: "uppercase", fontSize: 12 });
    const tick = screen.getByTestId("large-title-tick", { includeHiddenElements: true });
    expect(flat(tick.props.style)).toMatchObject({ width: 14, height: 3, backgroundColor: palette.yellow });
  });

  it("pushed screens get a back chevron with the parent's name", async () => {
    const back = jest.fn();
    await render(<LargeTitle eyebrow="Spaces and vehicles" title="Bookings" back={{ label: "Home", onPress: back }} />);
    const btn = screen.getByRole("button", { name: "Back to Home" });
    expect(styleOf(btn).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(btn);
    expect(back).toHaveBeenCalled();
  });

  it("hero is 34pt; the tick can be turned off; dark uses the dark text colour", async () => {
    mockScheme = "dark";
    await render(<LargeTitle title="Sign in" hero tick={false} eyebrow="FFSA Hub" />);
    expect(flat(screen.getByRole("header").props.style)).toMatchObject({ fontSize: 34, color: colors.dark.text });
    expect(screen.queryByTestId("large-title-tick", { includeHiddenElements: true })).toBeNull();
  });
});

describe("LargeTitleScrollView", () => {
  it("renders the title once for screen readers (the nav echo is hidden) and the content", async () => {
    await render(
      <LargeTitleScrollView eyebrow="Tickets" title="My tickets" back={{ label: "Home", onPress: () => {} }}>
        <WebHint />
      </LargeTitleScrollView>,
      { wrapper: withInsets },
    );
    expect(screen.getAllByRole("header", { name: "My tickets" })).toHaveLength(1);
    expect(screen.getAllByText("My tickets", { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getByText("Opens in browser")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Home" })).toBeTruthy();
  });

  it("tab roots have no back button and the collapsed bar starts invisible", async () => {
    await render(
      <LargeTitleScrollView title="Prayer">
        <></>
      </LargeTitleScrollView>,
      { wrapper: withInsets },
    );
    expect(screen.queryByRole("button")).toBeNull();
    const echo = screen.getAllByText("Prayer", { includeHiddenElements: true }).find((n) => n.props.accessibilityElementsHidden);
    expect(flat(echo!.props.style).opacity).toBe(0);
  });
});

describe("NeedsYouBand", () => {
  it("is a yellow 8pt fill with black text, read as one summary, with a 44pt black action", async () => {
    const onAction = jest.fn();
    await render(<NeedsYouBand eyebrow="Needs you · 3" text="Booking request: Seminar room" actionLabel="Open" onAction={onAction} testID="band" />);
    expect(flat(screen.getByTestId("band").props.style)).toMatchObject({ backgroundColor: palette.yellow, borderRadius: 8 });
    expect(flat(screen.getByTestId("band").props.style).borderWidth).toBeUndefined();
    expect(screen.getByRole("summary", { name: "Needs you · 3. Booking request: Seminar room" })).toBeTruthy();
    expect(flat(screen.getByText("Booking request: Seminar room").props.style).color).toBe(palette.ink);
    const btn = screen.getByRole("button", { name: "Open" });
    expect(styleOf(btn)).toMatchObject({ minHeight: 44, borderRadius: 6, backgroundColor: palette.ink });
    await fireEvent.press(btn);
    expect(onAction).toHaveBeenCalled();
  });

  it("is still yellow with black text in dark", async () => {
    mockScheme = "dark";
    await render(<NeedsYouBand eyebrow="Needs you" text="Sign the code of conduct" testID="band" />);
    expect(flat(screen.getByTestId("band").props.style).backgroundColor).toBe(palette.yellow);
    expect(flat(screen.getByText("Sign the code of conduct").props.style).color).toBe(palette.ink);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a second band on one screen warns in development", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      <Screen>
        <NeedsYouBand eyebrow="Needs you" text="One" />
        <NeedsYouBand eyebrow="Needs you" text="Two" />
      </Screen>,
      { wrapper: withInsets },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 yellow"));
    warn.mockRestore();
  });
});

describe("ListGroup + ListRow", () => {
  it("is an inset 8pt card with hairlines between rows", async () => {
    await render(
      <ListGroup testID="group">
        <ListRow title="One" />
        <ListRow title="Two" />
        <ListRow title="Three" />
      </ListGroup>,
    );
    expect(flat(screen.getByTestId("group").props.style)).toMatchObject({
      marginHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.light.rule,
      backgroundColor: colors.light.surface,
    });
  });

  it("rows are 56pt+, buttons with the caption in the hint, and push with a chevron", async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Mozambique Outreach" subtitle="Team leader" icon={Wallet} onPress={onPress} />);
    const row = screen.getByRole("button", { name: "Mozambique Outreach" });
    expect(row.props.accessibilityHint).toBe("Team leader");
    expect(styleOf(row).minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it("unread rows have the dot, a bold title and say Unread; read rows are regular weight", async () => {
    const { rerender } = await render(<ListRow title="Booking approved" unread onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Unread. Booking approved" })).toBeTruthy();
    expect(screen.getByTestId("list-row-unread", { includeHiddenElements: true })).toBeTruthy();
    expect(flat(screen.getByText("Booking approved").props.style).fontFamily).toBe("Roboto_600SemiBold");
    await rerender(<ListRow title="Booking approved" unread={false} onPress={() => {}} />);
    expect(flat(screen.getByText("Booking approved").props.style).fontFamily).toBe("Roboto_400Regular");
  });

  it("web rows are links that say they open in the browser", async () => {
    await render(<ListRow title="Full profile" trailing="web" onPress={() => {}} />);
    expect(screen.getByRole("link", { name: "Full profile. Opens in browser" })).toBeTruthy();
    expect(screen.getByText("Opens in browser")).toBeTruthy();
  });

  it("disabled rows say so and ignore presses", async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Coming from finance office" onPress={onPress} disabled />);
    const row = screen.getByRole("button");
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("SectionHeader", () => {
  it("is a 15/600 sentence-case header with an underlined text action", async () => {
    const onAction = jest.fn();
    await render(<SectionHeader title="Needs you" actionLabel="Mark all read" onAction={onAction} />);
    const header = screen.getByRole("header", { name: "Needs you" });
    expect(flat(header.props.style)).toMatchObject({ fontSize: 15, fontFamily: "Roboto_600SemiBold" });
    expect(flat(header.props.style).textTransform).toBeUndefined();
    await fireEvent.press(screen.getByRole("button", { name: "Mark all read" }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe("StatusChip", () => {
  it.each([
    ["positive", "Paid"],
    ["attention", "Due soon"],
    ["danger", "Cancelled"],
    ["ink", "You"],
    ["quiet", "Staff"],
    ["dashed", "Needs a lead"],
  ] as const)("%s chips carry a word and an icon", async (variant, label) => {
    await render(<StatusChip variant={variant} label={label} testID="chip" />);
    const chip = screen.getByTestId("chip");
    expect(chip.props.accessibilityLabel).toBe(label);
    expect(screen.getByText(label)).toBeTruthy();
    // Icon present (hidden from screen readers; the word carries the meaning).
    expect(chip.props.children.filter(Boolean)).toHaveLength(2);
    expect(flat(chip.props.style)).toMatchObject({ minHeight: 24, borderRadius: 6 });
  });

  it("uses the dark status colours in dark", async () => {
    mockScheme = "dark";
    await render(<StatusChip variant="positive" label="Checked in" />);
    expect(flat(screen.getByText("Checked in").props.style).color).toBe(colors.dark.positiveText);
  });
});

describe("Button variants", () => {
  it("primary is yellow with a black label in dark", async () => {
    mockScheme = "dark";
    await render(<Button label="Save" />);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(styleOf(btn).backgroundColor).toBe(palette.yellow);
    expect(flat(screen.getByText("Save").props.style).color).toBe(palette.ink);
  });

  it("presses scale to .98, but not under Reduce Motion", async () => {
    const first = await render(<Button label="Save" onPress={() => {}} testOnly_pressed />);
    expect(styleOf(screen.getByRole("button")).transform).toEqual([{ scale: 0.98 }]);
    await first.unmount();
    mockReduceMotion = true;
    await render(<Button label="Save" onPress={() => {}} testOnly_pressed />);
    expect(styleOf(screen.getByRole("button")).transform).toBeUndefined();
  });

  it("small is 44pt; danger is outlined; dangerFill is filled; disabled is a quiet block", async () => {
    await render(
      <>
        <Button label="Small" size="small" />
        <Button label="Remove" variant="danger" />
        <Button label="Delete account" variant="dangerFill" />
        <Button label="Off" disabled />
        <Button label="Forgot password?" variant="text" />
      </>,
    );
    expect(styleOf(screen.getByRole("button", { name: "Small" })).minHeight).toBe(44);
    expect(styleOf(screen.getByRole("button", { name: "Remove" })).borderColor).toBe(colors.light.danger);
    expect(styleOf(screen.getByRole("button", { name: "Delete account" })).backgroundColor).toBe(colors.light.danger);
    const off = screen.getByRole("button", { name: "Off" });
    expect(off).toBeDisabled();
    expect(styleOf(off).backgroundColor).toBe(colors.light.surface);
    expect(flat(screen.getByText("Forgot password?").props.style).textDecorationLine).toBe("underline");
  });
});

describe("Banner", () => {
  it.each(["info", "offline", "queued", "error"] as const)("%s has a full border, an icon and 8pt corners", async (tone) => {
    await render(<Banner tone={tone} testID="b">Offline. Showing what was saved at 08:42.</Banner>);
    expect(flat(screen.getByTestId("b").props.style)).toMatchObject({ borderWidth: 1, borderRadius: 8 });
  });

  it("errors use the danger border, are alerts, and offer Try again", async () => {
    const retry = jest.fn();
    await render(
      <Banner tone="error" actionLabel="Try again" onAction={retry} testID="b">
        {"Couldn't refresh."}
      </Banner>,
    );
    expect(flat(screen.getByTestId("b").props.style).borderColor).toBe(colors.light.danger);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't refresh.");
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("TextField states", () => {
  it("focus draws a 2px blue ring in light and a yellow one in dark", async () => {
    const { rerender } = await render(<TextField label="Name" value="Gabriël" onChangeText={() => {}} />);
    await fireEvent(screen.getByLabelText("Name"), "focus");
    expect(flat(screen.getByTestId("text-field-box").props.style)).toMatchObject({ borderWidth: 2, borderColor: palette.blue });
    mockScheme = "dark";
    await rerender(<TextField label="Name" value="Gabriël" onChangeText={() => {}} />);
    expect(flat(screen.getByTestId("text-field-box").props.style).borderColor).toBe(palette.yellow);
  });

  it("errors draw a 2px danger outline and an announced message; the label is sentence case 13/600", async () => {
    await render(<TextField label="Email" value="x" onChangeText={() => {}} error="Plain-English reason." />);
    expect(flat(screen.getByTestId("text-field-box").props.style)).toMatchObject({ borderWidth: 2, borderColor: colors.light.danger });
    expect(screen.getByRole("alert")).toHaveTextContent("Plain-English reason.");
    const label = screen.getByText("Email", { includeHiddenElements: true });
    expect(flat(label.props.style)).toMatchObject({ fontSize: 13, fontFamily: "Roboto_600SemiBold" });
    expect(flat(label.props.style).textTransform).toBeUndefined();
  });

  it("read-only fields say they're disabled", async () => {
    await render(<TextField label="Email" value="a@b.co" editable={false} />);
    expect(screen.getByLabelText("Email").props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe("SegmentedControl", () => {
  const items = [
    { key: "week", label: "Week" },
    { key: "practice", label: "Practice" },
    { key: "mine", label: "My sets" },
  ] as const;

  it("is a tablist of 44pt tabs; the selected one is bold with a yellow underline", async () => {
    await render(<SegmentedControl items={items} value="week" onChange={() => {}} testID="seg" />);
    expect(screen.getByTestId("seg").props.accessibilityRole).toBe("tablist");
    const week = screen.getByRole("tab", { name: "Week" });
    expect(week.props.accessibilityState).toMatchObject({ selected: true });
    expect(styleOf(week)).toMatchObject({ minHeight: 44, borderBottomWidth: 2, borderBottomColor: palette.yellow });
    expect(flat(screen.getByText("Week").props.style).fontFamily).toBe("Roboto_700Bold");
    expect(flat(screen.getByText("Practice").props.style).fontFamily).toBe("Roboto_500Medium");
  });

  it("changes selection with a haptic tick, and ignores the selected tab", async () => {
    const onChange = jest.fn();
    await render(<SegmentedControl items={items} value="week" onChange={onChange} />);
    await fireEvent.press(screen.getByRole("tab", { name: "My sets" }));
    expect(onChange).toHaveBeenCalledWith("mine");
    expect(Haptics.selectionAsync).toHaveBeenCalled();
    onChange.mockClear();
    await fireEvent.press(screen.getByRole("tab", { name: "Week" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dark: the selected segment uses the raised dark fill", async () => {
    mockScheme = "dark";
    await render(<SegmentedControl items={items} value="practice" onChange={() => {}} />);
    expect(styleOf(screen.getByRole("tab", { name: "Practice" })).backgroundColor).toBe(colors.dark.segmentOn);
  });
});

describe("Sheet", () => {
  it("has a title header, a × close button and 8pt top corners; closes on ×", async () => {
    const onClose = jest.fn();
    await render(
      <Sheet visible title="Budget line" subtitle="Pick one" onClose={onClose} testID="sheet">
        <WebHint />
      </Sheet>,
      { wrapper: withInsets },
    );
    expect(screen.getByRole("header", { name: "Budget line" })).toBeTruthy();
    expect(screen.getByText("Pick one")).toBeTruthy();
    expect(flat(screen.getByTestId("sheet").props.style)).toMatchObject({ borderTopLeftRadius: 8, borderTopRightRadius: 8 });
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the raised dark surface and the dark scrim in dark; custom close label", async () => {
    mockScheme = "dark";
    await render(
      <Sheet visible title="Lineup" onClose={() => {}} closeLabel="Done" testID="sheet" footer={<Button label="Save" />}>
        <></>
      </Sheet>,
      { wrapper: withInsets },
    );
    expect(flat(screen.getByTestId("sheet").props.style).backgroundColor).toBe(colors.dark.raised);
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("PhotoSlot", () => {
  it("empty: a dashed slot with Take / Choose", async () => {
    await render(<PhotoSlot hasPhoto={false} onTake={() => {}} onChoose={() => {}} onView={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole("image", { name: "No photo yet" })).toBeTruthy();
    expect(flat(screen.getByRole("image").props.style).borderStyle).toBe("dashed");
    expect(screen.getAllByRole("button").map((b) => b.props.accessibilityLabel)).toEqual(["Take a photo", "Choose a photo"]);
  });

  it("on file: a locked tile (never a preview) with View / Take / Choose / Remove; busy disables them", async () => {
    await render(<PhotoSlot hasPhoto busy onTake={() => {}} onChoose={() => {}} onView={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole("image", { name: "Photo on file" })).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(["View", "Take a photo", "Choose a photo", "Remove"]);
    for (const b of buttons) expect(b).toBeDisabled();
  });
});

describe("EmptyState", () => {
  it("is a calm card with a header and an optional Try again", async () => {
    const retry = jest.fn();
    await render(<EmptyState title="Couldn't load your bookings." body="Check your signal, then try again." actionLabel="Try again" onAction={retry} />);
    expect(screen.getByRole("header", { name: "Couldn't load your bookings." })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("Skeleton", () => {
  it("SkeletonList is one labelled progress element in the list layout", async () => {
    await render(<SkeletonList label="Loading your tickets" count={2} />);
    expect(screen.getByRole("progressbar", { name: "Loading your tickets" })).toBeTruthy();
    expect(screen.getAllByTestId("skeleton-block", { includeHiddenElements: true })).toHaveLength(4);
  });

  it("is static under Reduce Motion", async () => {
    mockReduceMotion = true;
    await render(<Skeleton />);
    const block = screen.getByTestId("skeleton-block", { includeHiddenElements: true });
    expect(flat(block.props.style)).toMatchObject({ borderRadius: 6, backgroundColor: colors.light.surfaceStrong, opacity: 1 });
  });
});

describe("MoneyText", () => {
  it("formats with formatMoney (no-break spaces, cents) and speaks with moneyLabel", async () => {
    await render(<MoneyText amount={3240} />);
    const el = screen.getByText("R 3 240.00");
    expect(el.props.accessibilityLabel).toBe("3240 rand");
    expect(flat(el.props.style).fontVariant).toEqual(["tabular-nums"]);
  });

  it("whole rands on budget summaries", async () => {
    await render(<MoneyText amount={94090.4} options={{ cents: false }} variant="kpi" />);
    expect(screen.getByText("R 94 090")).toBeTruthy();
  });
});

describe("WebHint", () => {
  it("says Opens in browser", async () => {
    await render(<WebHint />);
    expect(screen.getByText("Opens in browser")).toBeTruthy();
  });
});

describe("Toggle", () => {
  it("is a labelled native switch: ink when on in light", async () => {
    const onValueChange = jest.fn();
    await render(<Toggle value accessibilityLabel="Prayer Room" onValueChange={onValueChange} />);
    const sw = screen.getByRole("switch", { name: "Prayer Room" });
    expect(sw.props.onTintColor).toBe(palette.ink);
    expect(sw.props.accessibilityState).toMatchObject({ checked: true });
  });

  it("yellow with a black thumb when on in dark; disabled says so", async () => {
    mockScheme = "dark";
    await render(<Toggle value disabled accessibilityLabel="Finance" />);
    const sw = screen.getByRole("switch", { name: "Finance" });
    expect(sw.props.onTintColor).toBe(palette.yellow);
    expect(sw.props.thumbTintColor).toBe(palette.ink);
    expect(sw.props.accessibilityState).toMatchObject({ disabled: true });
  });
});
