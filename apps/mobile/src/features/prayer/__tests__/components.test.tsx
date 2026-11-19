// The Prayer slice's own building blocks (not in the shared kit): the Mon–Fri
// day strip, the set row, the band chip and the week stepper, in light and dark.
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { StyleSheet } from "react-native";

import { colors as tokens } from "@/theme/tokens";

import { bandSchema, prayerSetSchema, seatTypeSchema } from "../api";
import { DayStrip } from "../components/DayStrip";
import { SetRow } from "../components/SetRow";
import { BandChip, DayHeader, WeekNav } from "../components/ui";
import { stripDays } from "../day-strip";
import { strings } from "../strings";
import { BANDS, ME_ID, SEAT_TYPES, UNLED, prayerSet, slot, person } from "../__fixtures__/fixtures";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => {}) }));

const flatten = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
/** A Pressable's style for its resting state. */
const resting = (node: { props: Record<string, unknown> }) => flatten(node.props.style);

const DAYS = stripDays("2026-11-15"); // Mon 16 – Fri 20 Nov 2026
const seatTypes = SEAT_TYPES.map((s) => seatTypeSchema.parse(s));
const bands = BANDS.map((b) => bandSchema.parse(b));

beforeEach(() => {
  mockScheme = "light";
  (Haptics.selectionAsync as jest.Mock).mockClear();
});

describe.each(["light", "dark"] as const)("DayStrip (%s)", (scheme) => {
  const c = tokens[scheme];
  beforeEach(() => {
    mockScheme = scheme;
  });

  async function strip(onSelect = jest.fn()) {
    await render(
      <DayStrip
        days={DAYS}
        selected="2026-11-18"
        today="2026-11-18"
        markers={{ "2026-11-16": "you", "2026-11-17": "blocked", "2026-11-18": "noLead", "2026-11-19": "invited" }}
        onSelect={onSelect}
      />,
    );
    return onSelect;
  }

  it("five 56pt day buttons, Monday to Friday", async () => {
    await strip();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => within(t).getByText(/^(Mon|Tue|Wed|Thu|Fri)$/).props.children)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    for (const t of tabs) expect(resting(t)).toMatchObject({ minHeight: 56, flex: 1 });
  });

  it("selected = ink fill with the text inverted; the others are plain", async () => {
    await strip();
    const on = screen.getByTestId("day-tab-2026-11-18");
    expect(resting(on).backgroundColor).toBe(c.inverse);
    expect(flatten(within(on).getByText("18").props.style).color).toBe(c.onInverse);
    const off = screen.getByTestId("day-tab-2026-11-16");
    expect(resting(off).backgroundColor).toBe("transparent");
    expect(flatten(within(off).getByText("16").props.style).color).toBe(c.text);
  });

  it("markers: You / Invited filled, Blocked outlined, No lead dashed; inverted on the selected day", async () => {
    await strip();
    const box = (date: string) => flatten(screen.getByTestId(`day-marker-${date}`).props.style);
    expect(box("2026-11-16")).toMatchObject({ backgroundColor: c.text, borderColor: c.text });
    expect(flatten(screen.getByText("You").props.style).color).toBe(c.onInverse);
    expect(box("2026-11-19")).toMatchObject({ backgroundColor: c.text });
    expect(box("2026-11-17")).toMatchObject({ borderColor: c.text });
    expect(box("2026-11-17").backgroundColor).toBeUndefined();
    // On the selected (ink) day the dashed outline and the word turn to the ink's text colour.
    expect(box("2026-11-18")).toMatchObject({ borderStyle: "dashed", borderColor: c.onInverse });
    expect(flatten(screen.getByText("No lead").props.style).color).toBe(c.onInverse);
    // No marker: nothing announced, nothing drawn (the row keeps its height).
    expect(screen.queryByTestId("day-marker-2026-11-20")).toBeNull();
  });

  it("never yellow, and no text below 11pt", async () => {
    await strip();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toContain(c.accent);
    for (const t of screen.getAllByText(/./)) expect(Number(flatten(t.props.style).fontSize)).toBeGreaterThanOrEqual(11);
  });

  it("choosing another day ticks and calls back; the selected day does neither", async () => {
    const onSelect = await strip();
    await fireEvent.press(screen.getByTestId("day-tab-2026-11-18"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("day-tab-2026-11-20"));
    expect(onSelect).toHaveBeenCalledWith("2026-11-20");
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe("DayStrip without markers (loading, empty week)", () => {
  it("keeps the week's shape and marks today", async () => {
    await render(<DayStrip days={DAYS} selected="2026-11-16" today="2026-11-19" onSelect={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual([
      "Monday 16 November",
      "Tuesday 17 November",
      "Wednesday 18 November",
      "Thursday 19 November, today",
      "Friday 20 November",
    ]);
  });
});

describe.each(["light", "dark"] as const)("SetRow (%s)", (scheme) => {
  const c = tokens[scheme];
  beforeEach(() => {
    mockScheme = scheme;
  });
  const card = (id: string) => {
    const row = screen.getByTestId(`set-${id}`);
    // The Pressable's second child is the card.
    return flatten((row.children[1] as { props: Record<string, unknown> }).props.style);
  };
  const show = (raw: unknown, userId: string | null = ME_ID) =>
    render(<SetRow set={prayerSetSchema.parse(raw)} seatTypes={seatTypes} bands={bands} userId={userId} onPress={() => {}} />);

  it("an ordinary set: a quiet card", async () => {
    await show(prayerSet(), "someone-else");
    expect(card("s1")).toMatchObject({ borderWidth: 1, borderStyle: "solid", borderColor: c.rule, backgroundColor: c.surface, borderRadius: 8 });
    expect(screen.queryByText(strings.set.you)).toBeNull();
  });

  it("a set you're on: 2pt ink border and 'You'", async () => {
    await show(prayerSet());
    expect(card("s1")).toMatchObject({ borderWidth: 2, borderStyle: "solid", borderColor: c.text });
    expect(screen.getByText(strings.set.you)).toBeTruthy();
  });

  it("a set you set up: 2pt ink border and 'Your set'", async () => {
    await show(prayerSet({ owner_id: ME_ID, slots: [slot({ id: "a", seat: "prayer_lead", status: "filled", user: person("u2", "Sample") })] }));
    expect(card("s1")).toMatchObject({ borderWidth: 2, borderColor: c.text });
    expect(screen.getByText(strings.set.yourSet)).toBeTruthy();
  });

  it("nobody leads: a dashed card and 'Needs a lead'; invited says 'Invited'", async () => {
    await show(UNLED);
    expect(card("s2")).toMatchObject({ borderStyle: "dashed", borderColor: c.ruleStrong, backgroundColor: "transparent" });
    expect(screen.getByText(strings.set.needsLead)).toBeTruthy();
    expect(screen.getByText(strings.set.invited)).toBeTruthy();
  });

  it("is at least 64pt tall, with the times in a column that can grow", async () => {
    await show(prayerSet());
    const row = screen.getByTestId("set-s1");
    expect(flatten(row.props.style)).toMatchObject({ minHeight: 64, flexDirection: "row" });
    const column = flatten((row.children[0] as { props: Record<string, unknown> }).props.style);
    expect(column.minWidth).toBe(48);
    expect(column.width).toBeUndefined();
  });
});

describe("BandChip, DayHeader and WeekNav", () => {
  it("the band chip is the band's word in the text colour, never yellow", async () => {
    mockScheme = "dark";
    await render(<BandChip label="MORNING" />);
    expect(flatten(screen.getByText("MORNING").props.style).color).toBe(tokens.dark.text);
    expect(JSON.stringify(screen.toJSON())).not.toContain(tokens.dark.accent);
  });

  it("a day header shows the short date and speaks the long one", async () => {
    await render(<DayHeader date="2026-11-18" />);
    expect(screen.getByRole("header", { name: "Wednesday 18 November" })).toBeTruthy();
    expect(screen.getByText("Wed 18 Nov")).toBeTruthy();
  });

  it("the week stepper: 'This week' only away from the current week", async () => {
    const calls: string[] = [];
    const props = {
      label: "23–27 Nov 2026",
      spokenLabel: "Week of 23–27 Nov 2026",
      summary: "nothing booked",
      onPrev: () => calls.push("prev"),
      onNext: () => calls.push("next"),
      onToday: () => calls.push("today"),
    };
    const view = await render(<WeekNav {...props} isThisWeek={false} />);
    expect(screen.getByLabelText("Week of 23–27 Nov 2026. nothing booked")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.week.previous }));
    await fireEvent.press(screen.getByRole("button", { name: strings.week.next }));
    const today = screen.getByRole("button", { name: strings.week.today });
    expect(today.props.accessibilityHint).toBe(strings.week.todayHint);
    await fireEvent.press(today);
    expect(calls).toEqual(["prev", "next", "today"]);
    await view.rerender(<WeekNav {...props} isThisWeek />);
    expect(screen.queryByRole("button", { name: strings.week.today })).toBeNull();
  });
});
