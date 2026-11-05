import { fireEvent, render, screen } from "@testing-library/react-native";

import { OutboxItemStatus, OutboxSummary, StoreProblemNotice } from "../OutboxStatus";
import { outboxStrings } from "../strings";

const base = { id: "a", status: "waiting" as const, lastError: null, attempts: 0, lastTriedAt: null };
const now = new Date(2026, 10, 3, 15, 0).getTime();

describe("OutboxItemStatus", () => {
  it("offline: waiting for signal, in words", async () => {
    await render(<OutboxItemStatus item={base} online={false} now={now} />);
    expect(screen.getByText("Waiting for signal")).toBeTruthy();
    expect(screen.getByText(outboxStrings.next.offline)).toBeTruthy();
    expect(screen.queryByText(/Last tried/)).toBeNull();
  });

  it("online between tries: the last problem, that it will retry, and when it last tried", async () => {
    await render(
      <OutboxItemStatus item={{ ...base, lastError: "Server busy.", attempts: 2, lastTriedAt: new Date(2026, 10, 3, 14, 2).getTime() }} online now={now} />,
    );
    expect(screen.getByText("Waiting to try again")).toBeTruthy();
    expect(screen.getByText(`Server busy. ${outboxStrings.next.waiting}`)).toBeTruthy();
    expect(screen.getByText("Last tried 14:02")).toBeTruthy();
  });

  it("sending", async () => {
    await render(<OutboxItemStatus item={{ ...base, status: "sending" }} online now={now} />);
    expect(screen.getByText("Sending…")).toBeTruthy();
  });

  it("needs you: reason and next step", async () => {
    await render(<OutboxItemStatus item={{ ...base, status: "failed", lastError: "No access." }} online now={now} />);
    expect(screen.getByText("Needs you")).toBeTruthy();
    expect(screen.getByText(`No access. ${outboxStrings.next.needsYou}`)).toBeTruthy();
  });
});

describe("OutboxSummary", () => {
  it("counts waiting and needs-you items, and is absent when empty", async () => {
    const { rerender } = await render(<OutboxSummary items={[{ status: "waiting" }, { status: "failed" }]} />);
    expect(screen.getByText("1 waiting · 1 needs you")).toBeTruthy();
    await rerender(<OutboxSummary items={[]} />);
    expect(screen.queryByTestId("outbox-summary")).toBeNull();
  });
});

describe("StoreProblemNotice", () => {
  it("nothing when the store was fine", async () => {
    await render(<StoreProblemNotice problem={null} onDismiss={() => {}} />);
    expect(screen.queryByTestId("outbox-store-problem")).toBeNull();
  });

  it("corrupt and partial each explain what happened and what to do; OK dismisses", async () => {
    const onDismiss = jest.fn();
    const { rerender } = await render(<StoreProblemNotice problem="corrupt" onDismiss={onDismiss} />);
    expect(screen.getByText(outboxStrings.problem.title)).toBeTruthy();
    expect(screen.getByText(outboxStrings.problem.corrupt)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: outboxStrings.problem.dismiss }));
    expect(onDismiss).toHaveBeenCalled();
    await rerender(<StoreProblemNotice problem="partial" onDismiss={onDismiss} />);
    expect(screen.getByText(outboxStrings.problem.partial)).toBeTruthy();
  });
});
