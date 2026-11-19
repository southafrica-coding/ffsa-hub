import { render, screen } from "@testing-library/react-native";
import * as RN from "react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { wordBreakRisks } from "@/lib/a11y/testing";

import { eyebrowTickOffset } from "../LargeTitle";
import { SEGMENT_LABEL_MAX_SCALE, segmentShare } from "../SegmentedControl";
import { Banner, ChoiceSegments, GroupRow, InfoRow, LargeTitle, ListGroup, ListRow, NeedsYouBand, SectionHeader, SectionTitle, SegmentedControl, StatusChip } from "..";

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
      <GroupRow onPress={noop}>
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
