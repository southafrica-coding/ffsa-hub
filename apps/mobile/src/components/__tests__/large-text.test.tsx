import { act, render, screen } from "@testing-library/react-native";
import * as RN from "react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Field, FieldList } from "@/features/bookings/components/ui";
import { Figure, FigureStrip } from "@/features/okrs/components/ui";
import { wordBreakRisks } from "@/lib/a11y/testing";

import { eyebrowTickOffset } from "../LargeTitle";
import { SEGMENT_LABEL_MAX_SCALE, segmentShare } from "../SegmentedControl";
import { Banner, ChoiceSegments, GroupRow, InfoRow, LargeTitle, ListGroup, ListRow, NeedsYouBand, SectionHeader, SectionTitle, SegmentedControl, StatusChip, Text } from "..";

// Text never breaks inside a word (QA visual pass, Nov 2026: "Tod/ay",
// "Need/s you", "Leadershi/p"). The test renderer has no layout, so this
// checks the structure that keeps words whole at large text: nothing puts two
// wrapping texts side by side in a row that can't wrap, no text gets a fixed
// width, and each fixed component takes its large-text layout.

jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => {}) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const noop = () => {};

function atScale(fontScale: number) {
  return jest.spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useWindowDimensions").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
}
afterEach(() => jest.restoreAllMocks());

const renderKit = async (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

// Long, real labels from the report.
function Kit() {
  return (
    <RN.View>
      <LargeTitle eyebrow="Thu 19 Nov · All schools · Leadership Track" title="Your week, Jack" />
      <NeedsYouBand eyebrow="Needs you" text="43 students haven't had a check-in" detail="Team member's insurance expired" actionLabel="Open" onAction={noop} />
      <SegmentedControl
        items={[
          { key: "today", label: "Today" },
          { key: "schools", label: "Schools" },
          { key: "applicants", label: "Applicants" },
          { key: "people", label: "People" },
        ]}
        value="today"
        onChange={noop}
      />
      <ChoiceSegments label="Accepted?" options={[{ value: "yes", label: "Accepted" }, { value: "no", label: "Not accepted" }]} value={null} onChange={noop} />
      <SectionHeader title="Needs you (11)" actionLabel="Mark all read" onAction={noop} />
      <SectionTitle title="Outreach teams" meta="1 team" />
      <GroupRow onPress={noop} accessibilityLabel="Approvals">
        <InfoRow title="Approvals" subtitle="For Coreen Steyn and the finance office" meta="Not built yet" />
      </GroupRow>
      <ListGroup>
        <ListRow title="Eswatini Leadership Track 26'" subtitle="Leadership Track Q4/2026 · Eswatini · Co-leader" onPress={noop} />
      </ListGroup>
      <StatusChip label="Active" variant="quiet" icon={null} />
      <Banner tone="error" actionLabel="Try again" onAction={noop}>
        {"Couldn't refresh your outreach teams."}
      </Banner>
    </RN.View>
  );
}

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

const all = (n: Node): Node[] => [n, ...(n.children ?? []).filter((c): c is Node => typeof c !== "string").flatMap(all)];
const flatten = (st: unknown) => (StyleSheet.flatten(st as RN.StyleProp<RN.ViewStyle>) ?? {}) as Record<string, unknown>;

describe("large text: words stay whole across the kit", () => {
  it.each([2, 3.1])("at fontScale %s no text is squeezed beside another or given a fixed width", async (scale) => {
    atScale(scale);
    await renderKit(<Kit />);
    expect(wordBreakRisks(screen.toJSON() as never, flatten)).toEqual([]);
  });
});

// Feature pieces with the same side-by-side shape (QA pass 2: "Auditoriu/m",
// "13 Aug / 2027 – 14", "Objectiv/es").
function Features() {
  return (
    <RN.View>
      <FieldList>
        <Field label="Space" value="Auditorium · FFSA Building" />
        <Field label="When" value="13 Aug 2027 – 14 Aug 2027" />
        <Field label="People" value="Ashlyn Janzen/Sarah" />
      </FieldList>
      <FigureStrip four>
        <Figure label="Objectives" value={4} />
        <Figure label="Key results" value={11} />
        <Figure label="Complete" value={5} />
        <Figure label="Stuck" value={1} tone="danger" />
      </FigureStrip>
    </RN.View>
  );
}

describe("large text: words stay whole in feature pieces", () => {
  it.each([2, 3])("at fontScale %s the booking fields and OKR figures keep words whole", async (scale) => {
    atScale(scale);
    await renderKit(<Features />);
    expect(wordBreakRisks(screen.toJSON() as never, flatten)).toEqual([]);
  });
});

// The text size can change while the app is open, both ways (QA pass 2: after
// going back down, the band kept its stacked layout and its text ran off the
// right edge). Each piece takes the layout for the current size, as a new view
// so iOS measures it afresh.
describe("large text: the text size changes while the app is open", () => {
  const ui = (
    <RN.View>
      <NeedsYouBand eyebrow="Needs you" text="43 students haven't had a check-in" actionLabel="Open" onAction={noop} testID="band" />
      <SectionHeader title="Needs you (11)" actionLabel="Mark all read" onAction={noop} testID="sh" />
      <SectionTitle title="Outreach teams" meta="1 team" testID="st" />
      <Features />
    </RN.View>
  );
  const direction = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).flexDirection;

  // The real path: iOS sends a Dimensions change and useWindowDimensions re-renders.
  const textSize = async (fontScale: number) => {
    const window = { width: 390, height: 844, scale: 3, fontScale };
    await act(async () => RN.Dimensions.set({ window, screen: window }));
  };
  afterEach(() => RN.Dimensions.set({ window: { width: 750, height: 1334, scale: 2, fontScale: 2 }, screen: { width: 750, height: 1334, scale: 2, fontScale: 2 } }));

  it("1 → 2 → 1: each piece re-lays out, and is a new view each time", async () => {
    await textSize(1);
    await renderKit(ui);
    const first = screen.getByTestId("band");
    expect(["band", "sh", "st"].map(direction)).toEqual(["row", "row", "row"]);

    await textSize(2);
    const large = screen.getByTestId("band");
    expect(["band", "sh", "st"].map(direction)).toEqual(["column", "column", "column"]);
    expect(large).not.toBe(first);
    expect(wordBreakRisks(screen.toJSON() as never, flatten)).toEqual([]);

    await textSize(1);
    expect(["band", "sh", "st"].map(direction)).toEqual(["row", "row", "row"]);
    expect(screen.getByTestId("band")).not.toBe(large);
  });

  it("every kit Text is a new native text after a change, so none keeps the old size", async () => {
    await textSize(2);
    await renderKit(<Text>Copies your own visa and health insurance details.</Text>);
    const before = screen.getByText(/Copies your own/);
    await textSize(1);
    expect(screen.getByText(/Copies your own/)).not.toBe(before);
  });
});

describe("SegmentedControl", () => {
  const items = [
    { key: "today", label: "Today" },
    { key: "applicants", label: "Applicants" },
  ] as const;

  it("labels stay on one line, capped at twice the size, in a sideways-scrolling track", async () => {
    atScale(3.1);
    await renderKit(<SegmentedControl items={items} value="today" onChange={noop} testID="seg" />);
    for (const key of ["today", "applicants"]) {
      const labelText = screen.getByText(key === "today" ? "Today" : "Applicants");
      expect(labelText.props.numberOfLines).toBe(1);
      expect(labelText.props.maxFontSizeMultiplier).toBe(SEGMENT_LABEL_MAX_SCALE);
    }
    expect(all(screen.toJSON() as Node).some((n) => n.type === "RCTScrollView" && n.props.horizontal === true)).toBe(true);
  });

  it("segments never shrink below their label, and keep the 44pt floor", async () => {
    atScale(1);
    await renderKit(<SegmentedControl items={items} value="today" onChange={noop} />);
    const seg = StyleSheet.flatten(screen.getByTestId("segment-applicants").props.style) as RN.ViewStyle;
    expect(seg.flexShrink).toBe(0);
    expect(seg.flex).toBeUndefined();
    expect(seg.minHeight).toBeGreaterThanOrEqual(44);
    expect(seg.minWidth).toBe(segmentShare(390 - 32, 2));
  });

  it("equal shares fill the track exactly when they fit", async () => {
    // 1pt hairline borders, 3pt padding, 3pt gaps.
    expect(segmentShare(358, 4)).toBe(Math.floor((358 - 2 * RN.StyleSheet.hairlineWidth - 6 - 9) / 4));
    expect(segmentShare(100, 4)).toBe(44);
  });
});

describe("SectionHeader", () => {
  it("at large text the action goes under the title", async () => {
    atScale(3.1);
    await renderKit(<SectionHeader title="Needs you (11)" actionLabel="Mark all read" onAction={noop} testID="sh" />);
    expect(StyleSheet.flatten(screen.getByTestId("sh").props.style)).toMatchObject({ flexDirection: "column", alignItems: "flex-start" });
  });

  it("at normal text the row wraps instead of squeezing the title", async () => {
    atScale(1);
    await renderKit(<SectionHeader title="Needs you (11)" actionLabel="Mark all read" onAction={noop} testID="sh" />);
    expect(StyleSheet.flatten(screen.getByTestId("sh").props.style)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
  });
});

describe("NeedsYouBand", () => {
  it.each([
    [1, "row"],
    [3.1, "column"],
  ])("at fontScale %s the button sits %s-wise", async (scale, direction) => {
    atScale(scale);
    await renderKit(<NeedsYouBand eyebrow="Needs you" text="11 things need you" actionLabel="Open" onAction={noop} testID="band" />);
    expect(StyleSheet.flatten(screen.getByTestId("band").props.style)).toMatchObject({ flexDirection: direction });
  });
});

describe("Banner", () => {
  it("the action keeps a 44pt target from hitSlop, with no negative margin to spill over the border", async () => {
    atScale(3.1);
    await renderKit(
      <Banner tone="error" actionLabel="Try again" onAction={noop}>
        {"This ministry has been removed."}
      </Banner>,
    );
    const action = screen.getByRole("button", { name: "Try again" });
    const st = StyleSheet.flatten(action.props.style) as RN.ViewStyle;
    expect([st.margin, st.marginVertical, st.marginTop, st.marginBottom].filter((m) => typeof m === "number" && m < 0)).toEqual([]);
    const slop = action.props.hitSlop as RN.Insets;
    expect(18 + (slop.top ?? 0) + (slop.bottom ?? 0)).toBeGreaterThanOrEqual(44);
  });
});

describe("Eyebrow", () => {
  it.each([1, 2.35, 3.1])("at fontScale %s the tick centres on the first line, not the wrapped block", async (scale) => {
    atScale(scale);
    await renderKit(<LargeTitle eyebrow="Thu 19 Nov · All schools · Leadership Track" title="Your week" />);
    const tick = screen.getByTestId("large-title-tick", { includeHiddenElements: true });
    expect(StyleSheet.flatten(tick.props.style)).toMatchObject({ marginTop: eyebrowTickOffset(scale) });
    expect(StyleSheet.flatten(tick.parent?.props.style)).toMatchObject({ alignItems: "flex-start" });
    expect(eyebrowTickOffset(scale)).toBeCloseTo((16 * scale - 3) / 2);
  });
});
