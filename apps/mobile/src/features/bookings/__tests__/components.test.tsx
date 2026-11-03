import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { ConflictList } from "../components/ConflictList";
import { DateTimeField } from "../components/DateTimeField";
import { CheckRow, StatusLine } from "../components/ui";
import { strings } from "../strings";
import { inSafeArea } from "../__fixtures__/screen-mocks";

const mockOpen = jest.fn();
let mockPicked: Date | null = null;
jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable } = jest.requireActual("react-native");
  return {
    __esModule: true,
    // The iOS wheel: pressing it "turns" to the date the test chose.
    default: ({ onChange }: { onChange: (e: unknown, d?: Date) => void }) => (
      <Pressable testID="ios-wheel" onPress={() => onChange({ type: "set" }, mockPicked ?? undefined)} />
    ),
    DateTimePickerAndroid: { open: (opts: unknown) => mockOpen(opts) },
  };
});

describe("StatusLine", () => {
  it("is an icon plus words, read as the words", async () => {
    await render(<StatusLine status="denied" />);
    expect(screen.getByLabelText("Declined")).toBeTruthy();
    expect(screen.getByText("Declined")).toBeTruthy();
  });
});

describe("CheckRow", () => {
  it("is a checkbox with its state", async () => {
    const onChange = jest.fn();
    await render(<CheckRow label="Roof" checked={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Roof" });
    expect(box.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ConflictList", () => {
  const c = { date: "2026-11-10", existingId: "x", existingTitle: "Staff meeting", existingTime: "all day", occupiedUntil: "the end of the day", who: null };

  it("a block says so with a title and help (not colour alone)", async () => {
    await render(<ConflictList conflicts={[c]} blocked />);
    expect(screen.getByText(strings.clash.blockedTitle)).toBeTruthy();
    expect(screen.getByText(strings.clash.blockedHelp)).toBeTruthy();
    expect(screen.getByTestId("clash-blocked").props.accessibilityRole).toBe("alert");
  });

  it("long lists are capped", async () => {
    await render(<ConflictList conflicts={Array.from({ length: 10 }, (_, i) => ({ ...c, existingId: `x${i}` }))} blocked={false} />);
    expect(screen.getByText(strings.clash.warnTitle)).toBeTruthy();
    expect(screen.getByText(strings.clash.more(2))).toBeTruthy();
  });

  it("nothing when there's no clash", async () => {
    await render(<ConflictList conflicts={[]} blocked={false} />);
    expect(screen.queryByTestId("clash-warning")).toBeNull();
  });
});

describe("DateTimeField", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
    mockOpen.mockReset();
    mockPicked = null;
  });

  it("reads its value aloud and says it opens a picker", async () => {
    await render(inSafeArea(<DateTimeField mode="date" label="Date" value="2026-11-10" onChange={jest.fn()} />));
    const field = screen.getByRole("button", { name: "Date: Tue 10 Nov 2026" });
    expect(field.props.accessibilityHint).toBe(strings.when.pickDate("Date"));
  });

  it("Android: the system dialog; a set value comes back as HH:MM", async () => {
    Platform.OS = "android";
    const onChange = jest.fn();
    await render(inSafeArea(<DateTimeField mode="time" label="Event starts" value="" onChange={onChange} testID="f" />));
    await fireEvent.press(screen.getByTestId("f"));
    const opts = mockOpen.mock.calls[0][0] as { mode: string; is24Hour: boolean; onChange: (e: { type: string }, d?: Date) => void };
    expect(opts).toMatchObject({ mode: "time", is24Hour: true });
    opts.onChange({ type: "dismissed" });
    expect(onChange).not.toHaveBeenCalled();
    opts.onChange({ type: "set" }, new Date(2026, 10, 10, 7, 5));
    expect(onChange).toHaveBeenCalledWith("07:05");
  });

  it("iOS: a bottom sheet with the wheel and Done", async () => {
    Platform.OS = "ios";
    const onChange = jest.fn();
    await render(inSafeArea(<DateTimeField mode="date" label="Date" value="" onChange={onChange} testID="f" />));
    expect(screen.getByText(strings.when.notSet)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("f"));
    mockPicked = new Date(2026, 11, 24);
    await fireEvent.press(screen.getByTestId("ios-wheel"));
    await fireEvent.press(screen.getByRole("button", { name: strings.when.done }));
    expect(onChange).toHaveBeenCalledWith("2026-12-24");
  });

  it("optional fields can be cleared", async () => {
    const onChange = jest.fn();
    await render(inSafeArea(<DateTimeField mode="time" label="Set-up" value="17:00" onChange={onChange} clearable />));
    await fireEvent.press(screen.getByRole("button", { name: `${strings.when.clear} Set-up` }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
