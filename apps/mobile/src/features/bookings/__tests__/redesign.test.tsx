// The redesign's pieces (frames 7.1–7.14, 13.2): each new or restyled
// building block in light and dark, with its words and roles. Screen states
// are covered in lists / new-request / detail .screen.test.tsx.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { palette } from "@/theme/tokens";
import { LoadFailed, RadioRow, SectionTitle, StaleNote } from "@/components";

import { DecisionSheet } from "../components/DecisionSheet";
import { QueueList } from "../components/QueueList";
import { BookingRow, CheckRow, Field, FieldList, HintLine, Panel, StatusLine, YesNo } from "../components/ui";
import type { BookingItem } from "../logic";
import type { BookingsOutbox } from "../outbox/runner";
import { newFormItem } from "../outbox/state";
import { strings } from "../strings";
import { fakeOutbox, inSafeArea } from "../__fixtures__/screen-mocks";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});

const item = (over: Partial<BookingItem> = {}): BookingItem => ({
  kind: "space",
  id: "s1",
  title: "Worship night rehearsal",
  place: "Seminar room",
  status: "approved",
  start: "2099-12-03",
  end: "2099-12-03",
  when: "09:00 – 12:00",
  repeats: true,
  ...over,
});

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe.each(["light", "dark"] as const)("Bookings pieces (%s)", (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it("every status is a chip with its word", async () => {
    const statuses = ["pending", "approved", "denied", "cancelled", "completed"] as const;
    await render(
      <>
        {statuses.map((status) => (
          <StatusLine key={status} status={status} />
        ))}
      </>,
    );
    for (const status of statuses) {
      expect(screen.getByTestId(`status-${status}`).props.accessibilityLabel).toBe(strings.status[status]);
      // Never yellow text: the chip's colour is a status colour, not the accent.
      expect(flat(screen.getByText(strings.status[status]).props.style).color).not.toBe(palette.yellow);
    }
  });

  it("a booking row: name, place and dates, status chip and the weekly chip; one button", async () => {
    const onPress = jest.fn();
    await render(<BookingRow item={item()} onPress={onPress} />);
    const row = screen.getByTestId("booking-space-s1");
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toMatch(/^Space\. Worship night rehearsal\. Seminar room\./);
    expect(row.props.accessibilityLabel).toMatch(/Approved\.$/);
    expect(screen.getByText(/Seminar room · 3 Dec 2099 · 09:00 – 12:00/)).toBeTruthy();
    expect(screen.getByText(strings.row.repeats)).toBeTruthy();
    expect(flat(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it("a one-off booking has no weekly chip", async () => {
    await render(<BookingRow item={item({ repeats: false, kind: "vehicle", id: "v1" })} onPress={() => {}} />);
    expect(screen.queryByText(strings.row.repeats)).toBeNull();
    expect(screen.getByTestId("booking-vehicle-v1").props.accessibilityLabel).toMatch(/^Vehicle\./);
  });

  it("SectionTitle reads its count with its title", async () => {
    await render(<SectionTitle title="Upcoming" meta="2" />);
    expect(screen.getByRole("header", { name: "Upcoming, 2" })).toBeTruthy();
  });

  it("Field reads label and value as one; empty values draw nothing", async () => {
    await render(
      <FieldList>
        <Field label="Space" value="Seminar room" />
        <Field label="Set-down" value={null} />
      </FieldList>,
    );
    expect(screen.getByLabelText("Space: Seminar room")).toBeTruthy();
    expect(screen.queryByText("Set-down")).toBeNull();
  });

  it("HintLine says its verdict in words for every tone", async () => {
    await render(
      <>
        <HintLine tone="ok">Licence valid to 2099-01-01</HintLine>
        <HintLine tone="warn">Still needs the driving test.</HintLine>
        <HintLine tone="bad">Licence expired.</HintLine>
      </>,
    );
    expect(screen.getByText("Licence valid to 2099-01-01")).toBeTruthy();
    expect(screen.getByText("Still needs the driving test.")).toBeTruthy();
    expect(screen.getByText("Licence expired.")).toBeTruthy();
  });

  it("LoadFailed (13.2): what happened, what to do, and Try again", async () => {
    const onRetry = jest.fn();
    await render(<LoadFailed title={strings.home.errorTitle} message="Check your signal, then try again." onRetry={onRetry} />);
    expect(screen.getByRole("header", { name: strings.home.errorTitle })).toBeTruthy();
    expect(screen.getByText("Check your signal, then try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.tryAgain }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("StaleNote is the calm offline banner with Try again", async () => {
    const onRetry = jest.fn();
    await render(<StaleNote message={strings.common.offline} onRetry={onRetry} />);
    expect(screen.getByText(strings.common.offline)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.common.tryAgain }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("YesNo: unanswered until chosen; the chosen radio says so", async () => {
    const onChange = jest.fn();
    const view = await render(<YesNo label="All here?" hint="Everyone must be present." value={null} onChange={onChange} />);
    expect(screen.getByRole("header", { name: "All here?" })).toBeTruthy();
    expect(screen.getByText("Everyone must be present.")).toBeTruthy();
    const yes = screen.getByRole("radio", { name: strings.inspection.yes });
    expect(yes.props.accessibilityState).toMatchObject({ checked: false });
    expect(flat(yes.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(screen.getByRole("radio", { name: strings.inspection.no }));
    expect(onChange).toHaveBeenCalledWith(false);
    await view.rerender(<YesNo label="All here?" value={false} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: strings.inspection.no }).props.accessibilityState).toMatchObject({ checked: true, selected: true });
    expect(screen.getByRole("radio", { name: strings.inspection.yes }).props.accessibilityState).toMatchObject({ checked: false });
  });

  it("Panel: a headed card of ticks", async () => {
    const onChange = jest.fn();
    await render(
      <Panel title="Return condition" hint="Tick what's true." testID="panel">
        <CheckRow label="Washed" checked onChange={onChange} />
        <CheckRow label="Fuel full" checked={false} onChange={onChange} />
      </Panel>,
    );
    expect(screen.getByRole("header", { name: "Return condition" })).toBeTruthy();
    expect(screen.getByText("Tick what's true.")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Washed" }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fuel full" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(flat(screen.getByRole("checkbox", { name: "Fuel full" }).props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("RadioRow is at least a list row tall", async () => {
    await render(
      <RadioRow mark="leading" checked={false} accessibilityLabel="Main hall" onPress={() => {}} testID="c">
        <></>
      </RadioRow>,
    );
    expect(flat(screen.getByTestId("c").props.style).minHeight).toBeGreaterThanOrEqual(56);
  });

  it("DecisionSheet (7.10): Cancel beside the decision; decline is the filled red button", async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn(async () => null);
    await render(inSafeArea(<DecisionSheet decision="denied" onClose={onClose} onConfirm={onConfirm} hint={strings.decision.licenceHint} />));
    expect(screen.getByText(strings.decision.declineTitle)).toBeTruthy();
    expect(screen.getByText(strings.decision.licenceHint)).toBeTruthy();
    expect(screen.getByLabelText(strings.decision.noteLabel)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("decision-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("", false);
  });

  it("DecisionSheet: a weekly series offers every waiting date", async () => {
    const onConfirm = jest.fn(async () => null);
    await render(inSafeArea(<DecisionSheet decision="approved" onClose={() => {}} onConfirm={onConfirm} seriesOption />));
    expect(screen.getByText(strings.decision.approveTitle)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("decision-series"));
    await fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("", true);
  });

  it("QueueList (7.14): the saved check with its state in words and both actions", async () => {
    const form = newFormItem({ userId: "u1", bookingId: "b1", bookingName: "FF Kona", inspectionKind: "collection" }, {} as never, 1, "f1");
    await render(<QueueList items={[form]} outbox={fakeOutbox() as unknown as BookingsOutbox} online={false} />);
    expect(screen.getByRole("header", { name: strings.queue.title })).toBeTruthy();
    expect(screen.getByText(`${strings.queue.form("collection")} · FF Kona`)).toBeTruthy();
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getByText(strings.queue.offline)).toBeTruthy();
    expect(screen.getByRole("button", { name: `${strings.queue.retry}: ${strings.queue.form("collection")} · FF Kona` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${strings.queue.remove}: ${strings.queue.form("collection")} · FF Kona` })).toBeTruthy();
  });

  it("QueueList inside a photo section drops its own heading", async () => {
    const form = newFormItem({ userId: "u1", bookingId: "b1", bookingName: "FF Kona", inspectionKind: "return" }, {} as never, 1, "f1");
    await render(<QueueList items={[form]} outbox={fakeOutbox() as unknown as BookingsOutbox} online showTitle={false} />);
    expect(screen.queryByText(strings.queue.title)).toBeNull();
    expect(screen.getByText("1 waiting")).toBeTruthy();
  });
});
