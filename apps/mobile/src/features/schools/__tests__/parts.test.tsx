// The feature-local pieces My Schools and My History share (components/parts).

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { Text } from "@/components";
import type { LoadState } from "@/features/finance/use-cached-load";
import { colors } from "@/theme/tokens";

import { DateBlock, Figure, Freshness, GroupRow, LoadError, SectionCount, StatusTag } from "../components/parts";
import { strings } from "../strings";

jest.mock("@/features/finance/cache", () => ({ formatSavedAt: () => "09:05" }));

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const ready = (o: Partial<Extract<LoadState<number>, { status: "ready" }>>): LoadState<number> =>
  ({ status: "ready", data: 1, staleSince: null, refreshError: null, ...o }) as LoadState<number>;

describe("StatusTag", () => {
  it.each([
    ["positive", colors.light.positiveText],
    ["attention", colors.light.attention],
    ["danger", colors.light.danger],
    ["default", colors.light.rule],
  ] as const)("%s: the word is always there, the colour only helps", async (tone, border) => {
    await render(<StatusTag label="Arrived" tone={tone} testID="tag" />);
    const tag = screen.getByTestId("tag");
    expect(tag).toHaveTextContent("Arrived");
    expect(tag.props.accessibilityLabel).toBe("Arrived");
    expect(flat(tag)).toMatchObject({ borderColor: border, borderRadius: 6, minHeight: 24 });
  });
});

describe("SectionCount", () => {
  it("is one heading that reads the title and the count", async () => {
    await render(<SectionCount title="Courses" meta="4" />);
    const header = screen.getByRole("header", { name: "Courses, 4" });
    expect(flat(header).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByText("Courses")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });
});

describe("GroupRow", () => {
  it("with onPress: a named button with a hint, at least 56pt", async () => {
    const onPress = jest.fn();
    await render(
      <GroupRow onPress={onPress} accessibilityLabel="Leadership Track. Arrived" accessibilityHint="Shows courses" testID="row">
        <Text>Leadership Track</Text>
      </GroupRow>,
    );
    const row = screen.getByRole("button", { name: "Leadership Track. Arrived" });
    expect(row.props.accessibilityHint).toBe("Shows courses");
    expect(flat(row).minHeight).toBe(56);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it("without onPress: read as one line, not announced as a button", async () => {
    await render(
      <GroupRow accessibilityLabel="Identity. Grade A" testID="row" trail={<Text>Grade A</Text>}>
        <Text>Identity</Text>
      </GroupRow>,
    );
    const row = screen.getByTestId("row");
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(screen.getByText("Grade A")).toBeTruthy();
  });
});

describe("DateBlock", () => {
  it("is decoration (the row's label says the date) and never below 11pt", async () => {
    await render(<DateBlock day="03" mon="NOV" />);
    const mon = screen.getByText("NOV", { includeHiddenElements: true });
    expect(flat(mon).fontSize).toBeGreaterThanOrEqual(11);
    expect(screen.queryByText("03")).toBeNull();
  });
});

describe("Figure", () => {
  it("reads label, value and foot as one; the big one is 32pt", async () => {
    await render(
      <>
        <Figure label="Cumulative GPA" value="3.35" big />
        <Figure label="Credits earned" value="6" foot="of 12" />
      </>,
    );
    expect(screen.getByLabelText("Cumulative GPA, 3.35")).toBeTruthy();
    expect(screen.getByLabelText("Credits earned, 6, of 12")).toBeTruthy();
    expect(flat(screen.getByText("3.35")).fontSize).toBe(32);
    expect(flat(screen.getByText("6")).fontSize).toBe(24);
  });
});

describe("LoadError and Freshness", () => {
  it("LoadError: an alert with the title, what to do, and Try again", async () => {
    const onRetry = jest.fn();
    await render(<LoadError title="Couldn't load your schools" message={strings.common.network} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(strings.common.network)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.tryAgain }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("Freshness: nothing when fresh, loading or failed", async () => {
    await render(
      <>
        <Freshness state={ready({})} onRetry={jest.fn()} />
        <Freshness state={{ status: "loading" } as LoadState<number>} onRetry={jest.fn()} />
      </>,
    );
    expect(screen.queryByTestId("last-updated")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Freshness: 'Last updated' for a saved copy", async () => {
    await render(<Freshness state={ready({ staleSince: 1 })} onRetry={jest.fn()} />);
    expect(screen.getByTestId("last-updated")).toHaveTextContent(strings.common.lastUpdated("09:05"));
  });

  it("Freshness: a calm note (not an alert) with Try again when the refresh failed", async () => {
    const onRetry = jest.fn();
    await render(<Freshness state={ready({ staleSince: 1, refreshError: "offline" })} onRetry={onRetry} />);
    expect(screen.getByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.tryAgain }));
    expect(onRetry).toHaveBeenCalled();
  });
});
