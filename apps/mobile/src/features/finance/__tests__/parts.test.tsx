// The pieces first built for Finance's redesign, in their states, light and
// dark. Most now live in the kit (src/components); BudgetBar stays here.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ShieldCheck } from "lucide-react-native";

import { auditTappables, tappableSizes } from "@/lib/a11y/testing";
import { colors, touch } from "@/theme/tokens";
import { Button, ChipButton, ChoiceChips, Disclosure, FieldError, GroupRow, InfoRow, LoadError, NavBar, SectionTitle, SelectField, StaleNote, StatusLine, Text } from "@/components";

import { BudgetBar } from "../components/parts";
import { budgetFigures, formatMoney } from "../money";
import { strings } from "../strings";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});

const rands = (n: number) => formatMoney(n, "ZAR", { cents: false });
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
const noProblems = () => expect(auditTappables(screen.container as never)).toEqual([]);

beforeEach(() => {
  mockScheme = "light";
});

describe("BudgetBar", () => {
  it("full: Budget, Spent and Left in whole rands, a bar and the percentage in words", async () => {
    await render(<BudgetBar figures={budgetFigures(186400, 92310)} currency="ZAR" />);
    expect(screen.getByText(rands(186400))).toBeTruthy();
    expect(screen.getByText(rands(92310))).toBeTruthy();
    expect(screen.getByText(rands(94090))).toBeTruthy();
    expect(screen.getByText("49.5% spent")).toBeTruthy();
    expect(flat(screen.getByTestId("budget-bar-fill").props.style).backgroundColor).toBe(colors.light.text);
    expect(screen.getByRole("progressbar").props.accessibilityValue).toEqual({ min: 0, max: 100, now: 49 });
  });

  it("compact: the figures stay in the status line", async () => {
    await render(<BudgetBar figures={budgetFigures(10000, 2500)} currency="ZAR" compact />);
    expect(screen.getByText(`${rands(2500)} of ${rands(10000)} · 25% spent`)).toBeTruthy();
    expect(screen.queryByText(strings.team.budget)).toBeNull();
  });

  it.each(["light", "dark"] as const)("over budget says so in words, in the danger colour (%s)", async (scheme) => {
    mockScheme = scheme;
    await render(<BudgetBar figures={budgetFigures(4000, 4500)} currency="ZAR" compact />);
    const words = screen.getByText(`${rands(4500)} of ${rands(4000)} · Over budget by ${rands(500)}`);
    expect(flat(words.props.style).color).toBe(colors[scheme].danger);
    expect(flat(screen.getByTestId("budget-bar-fill").props.style)).toMatchObject({ backgroundColor: colors[scheme].danger, width: "100%" });
    expect(screen.getByRole("progressbar").props.accessibilityLabel).toMatch(/Over budget by 500 rand\.$/);
  });

  it("no budget: words only, no bar", async () => {
    await render(<BudgetBar figures={budgetFigures(0, 0)} currency="ZAR" />);
    expect(screen.getByText(strings.team.noBudget)).toBeTruthy();
    expect(screen.queryByTestId("budget-bar-fill")).toBeNull();
  });
});

describe("rows and headers", () => {
  it("SectionTitle reads the title and its count as one heading", async () => {
    await render(<SectionTitle title="Outreach teams" meta="3 teams" />);
    expect(screen.getByRole("header", { name: "Outreach teams, 3 teams" })).toBeTruthy();
    expect(screen.getByText("3 teams")).toBeTruthy();
  });

  it("GroupRow: a named button with a hint when it opens something, plain when it doesn't", async () => {
    const onPress = jest.fn();
    await render(
      <>
        <GroupRow onPress={onPress} accessibilityLabel="Burundi" accessibilityHint="Opens the team" testID="row">
          <StatusLine icon={ShieldCheck} tone="attention">
            1 saved on this phone, not yet sent
          </StatusLine>
        </GroupRow>
        <GroupRow accessibilityLabel="Food. Budget 100 rand">{null}</GroupRow>
      </>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Burundi" }));
    expect(onPress).toHaveBeenCalled();
    expect(flat(screen.getByTestId("row").props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(screen.getByLabelText("Food. Budget 100 rand")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    noProblems();
  });

  it("InfoRow is not something to tap, and reads as one line", async () => {
    await render(<InfoRow icon={ShieldCheck} title="Approvals" subtitle="For the finance office" meta="Not built yet" />);
    expect(screen.getByLabelText("Approvals. For the finance office. Not built yet")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(tappableSizes(screen.container as never, flat)).toEqual([]);
  });

  it("LoadError is an alert with Try again; StaleNote is calm with Try again", async () => {
    const retry = jest.fn();
    await render(
      <>
        <LoadError title="Couldn't load this team" message="Check your connection." onRetry={retry} />
        <StaleNote message="Couldn't refresh. Showing what was saved at 09:05." onRetry={retry} />
      </>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    for (const b of screen.getAllByRole("button", { name: strings.common.tryAgain })) await fireEvent.press(b);
    expect(retry).toHaveBeenCalledTimes(2);
  });
});

describe("form parts", () => {
  const OPTIONS = [
    { value: "cash", label: "Cash" },
    { value: "card", label: "Card" },
  ];

  it.each(["light", "dark"] as const)("ChoiceChips: the chosen chip is filled and bold, and says so (%s)", async (scheme) => {
    mockScheme = scheme;
    const onChange = jest.fn();
    await render(<ChoiceChips label="Paid by" options={OPTIONS} value="cash" onChange={onChange} />);
    expect(screen.getByRole("header", { name: "Paid by" })).toBeTruthy();
    const cash = screen.getByRole("radio", { name: "Cash" });
    expect(cash.props.accessibilityState).toMatchObject({ checked: true, selected: true });
    expect(flat(cash.props.style).backgroundColor).toBe(colors[scheme].inverse);
    expect(flat(screen.getByText("Cash").props.style).color).toBe(colors[scheme].onInverse);
    expect(flat(screen.getByRole("radio", { name: "Card" }).props.style).backgroundColor).toBe(colors[scheme].raised);
    await fireEvent.press(screen.getByRole("radio", { name: "Card" }));
    expect(onChange).toHaveBeenCalledWith("card");
    noProblems();
  });

  it("chips reach the 44pt target with their slop", async () => {
    await render(
      <>
        <ChoiceChips label="Currency" labelPlacement="hidden" options={OPTIONS} value={null} onChange={() => {}} />
        <ChipButton label="Today" onPress={() => {}} />
      </>,
    );
    expect(screen.queryByRole("header")).toBeNull();
    const sizes = tappableSizes(screen.container as never, flat);
    expect(sizes).toHaveLength(3);
    for (const t of sizes) {
      const slop = t.hitSlop as { top: number; bottom: number };
      expect((t.minHeight ?? 0) + slop.top + slop.bottom).toBeGreaterThanOrEqual(touch.floor);
    }
  });

  it("ChoiceChips disabled: can't be changed", async () => {
    const onChange = jest.fn();
    await render(<ChoiceChips label="Paid by" labelPlacement="inline" options={OPTIONS} value="cash" onChange={onChange} disabled />);
    await fireEvent.press(screen.getByRole("radio", { name: "Card" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Card" }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("SelectField: placeholder, value, error (2px danger outline + message in the hint)", async () => {
    const onPress = jest.fn();
    const { rerender } = await render(
      <SelectField label="Budget line" placeholder="Choose a budget line" accessibilityHint="Opens the list" onPress={onPress} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Budget line: Choose a budget line" }));
    expect(onPress).toHaveBeenCalled();

    await rerender(<SelectField label="Budget line" value="Food" placeholder="Choose" error="Choose a budget line." accessibilityHint="Opens the list" onPress={onPress} />);
    const box = screen.getByRole("button", { name: "Budget line: Food" });
    expect(flat(box.props.style)).toMatchObject({ borderWidth: 2, borderColor: colors.light.danger });
    expect(box.props.accessibilityHint).toBe("Choose a budget line. Opens the list");
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a budget line.");
    expect(flat(box.props.style).minHeight).toBeGreaterThanOrEqual(touch.floor);
  });

  it("Disclosure says whether it is open", async () => {
    const onPress = jest.fn();
    await render(<Disclosure label="More details" expanded={false} onPress={onPress} />);
    const row = screen.getByRole("button", { name: "More details" });
    expect(row.props.accessibilityState).toMatchObject({ expanded: false });
    expect(flat(row.props.style).minHeight).toBeGreaterThanOrEqual(touch.floor);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it("NavBar with a leading Cancel (the Add expense bar): Cancel and a heading", async () => {
    const onCancel = jest.fn();
    await render(
      <NavBar
        left={<Button label="Cancel" variant="ghost" onPress={onCancel} />}
        title={<Text accessibilityRole="header">Add expense</Text>}
      />,
    );
    expect(screen.getByRole("header", { name: "Add expense" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    noProblems();
  });

  it("FieldError is announced", async () => {
    await render(<FieldError>Add a photo of the receipt before saving.</FieldError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Add a photo of the receipt before saving.");
  });
});
