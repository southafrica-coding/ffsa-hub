// The OKR pieces the kit doesn't have: status chips keep their word, bars
// are clamped and hidden from screen readers, the figure strip falls back to
// two columns at large text, and everything is drawn from the theme.

import { render, screen } from "@testing-library/react-native";
import { Dimensions, StyleSheet, Text } from "react-native";

import { colors } from "@/theme/tokens";

import { Bar, Figure, FigureStrip, StatusTag } from "../components/ui";
import { strings } from "../strings";
import { OKR_STATUSES } from "../types";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => ({ ...jest.requireActual("@/theme/use-theme"), useTheme: () => jest.requireActual("@/theme/use-theme").themeFor(mockScheme) }));

const dimensions = (fontScale: number) => ({ width: 390, height: 844, scale: 3, fontScale });

beforeEach(() => {
  mockScheme = "light";
});
afterEach(() => jest.restoreAllMocks());

describe("StatusTag", () => {
  it.each(OKR_STATUSES)("%s: the word is always there", async (status) => {
    await render(<StatusTag status={status} testID="tag" />);
    expect(screen.getByText(strings.status[status])).toBeTruthy();
    expect(screen.getByTestId("tag").props.accessibilityLabel).toBe(strings.status[status]);
  });

  it("a tally reads as its text; stuck is the danger colour in both schemes", async () => {
    const view = await render(<StatusTag status="stuck" text="2 Stuck" testID="tag" />);
    expect(screen.getByLabelText("2 Stuck")).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId("tag").props.style).borderColor).toBe(colors.light.danger);
    await view.unmount();
    mockScheme = "dark";
    await render(<StatusTag status="stuck" testID="tag" />);
    expect(StyleSheet.flatten(screen.getByTestId("tag").props.style).borderColor).toBe(colors.dark.danger);
  });
});

describe("Bar", () => {
  it("is clamped to the track and left to its caption for screen readers", async () => {
    await render(<Bar pct={140} testID="fill" />);
    const fill = screen.getByTestId("fill", { includeHiddenElements: true });
    expect(StyleSheet.flatten(fill.props.style).width).toBe("100%");
    expect(screen.queryByTestId("fill")).toBeNull();
  });
});

describe("Figure and FigureStrip", () => {
  const four = (
    <FigureStrip four>
      <Figure label="Objectives" value={4} testID="f1" />
      <Figure label="Key results" value={11} />
      <Figure label="Complete" value={5} />
      <Figure label="Stuck" value={1} tone="danger" />
    </FigureStrip>
  );
  const basisOf = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).parent?.props.style ?? {}).flexBasis;

  it("reads label, number and foot as one; the bar only when a ratio is given", async () => {
    await render(
      <>
        <Figure label="Key results" value={96} foot="41 complete" barPct={43} />
        <Figure label="Objectives" value={38} />
        <Text>end</Text>
      </>,
    );
    expect(screen.getByLabelText("Key results, 96, 41 complete")).toBeTruthy();
    expect(screen.getByLabelText("Objectives, 38")).toBeTruthy();
  });

  it("four short figures share one line at normal text size", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue(dimensions(1));
    await render(four);
    expect(basisOf("f1")).toBe("20%");
  });

  it("at large text the four fall back to two columns, so labels never break mid-word", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue(dimensions(1.6));
    await render(four);
    expect(basisOf("f1")).toBe("40%");
  });
});
