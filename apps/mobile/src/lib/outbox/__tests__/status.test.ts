import { MAX_ATTEMPTS } from "../backoff";
import { countStates, formatWhen, itemState, lastTriedText, stateDetail, stateLabel, statusSentence, summaryText } from "../status";
import { outboxStrings } from "../strings";

const base = { status: "waiting" as const, lastError: null, attempts: 0, lastTriedAt: null };

describe("outbox status in words", () => {
  it("one clear state per item", () => {
    expect(stateLabel(itemState(base, false))).toBe("Waiting for signal");
    expect(stateLabel(itemState(base, true))).toBe("Waiting to try again");
    expect(stateLabel(itemState({ status: "sending" }, true))).toBe("Sending…");
    expect(stateLabel(itemState({ status: "failed" }, false))).toBe("Needs you");
  });

  it("needs you: the specific reason plus a next step", () => {
    expect(stateDetail({ ...base, status: "failed", lastError: "No access." }, true)).toBe(`No access. ${outboxStrings.next.needsYou}`);
    expect(stateDetail({ ...base, status: "failed", lastError: "No signal.", attempts: MAX_ATTEMPTS }, true)).toBe(`No signal. ${outboxStrings.gaveUp}`);
    expect(stateDetail({ ...base, status: "failed" }, true)).toBe(outboxStrings.next.needsYou);
  });

  it("waiting: says it will go by itself (with the last problem if there was one)", () => {
    expect(stateDetail(base, false)).toBe(outboxStrings.next.offline);
    expect(stateDetail({ ...base, lastError: "Server busy." }, true)).toBe(`Server busy. ${outboxStrings.next.waiting}`);
    expect(stateDetail({ ...base, status: "sending" }, true)).toBe(outboxStrings.next.sending);
  });

  it("last tried: clock today, date otherwise, nothing if never tried", () => {
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    expect(formatWhen(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatWhen(new Date(2026, 10, 1, 21, 30).getTime(), now)).toBe("1 Nov, 21:30");
    expect(lastTriedText({ lastTriedAt: new Date(2026, 10, 3, 14, 2).getTime() }, now)).toBe("Last tried 14:02");
    expect(lastTriedText({ lastTriedAt: null }, now)).toBeNull();
  });

  it("counts what's waiting and what needs the person", () => {
    const items = [base, { status: "sending" as const }, { status: "failed" as const }];
    expect(countStates(items)).toEqual({ waiting: 2, needsYou: 1 });
    expect(summaryText(items)).toBe("2 waiting · 1 needs you");
    expect(summaryText([{ status: "failed" }, { status: "failed" }])).toBe("2 need you");
    expect(summaryText([])).toBe("");
  });

  it("one sentence for screen readers", () => {
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    expect(statusSentence({ ...base, status: "failed", lastError: "No access.", lastTriedAt: new Date(2026, 10, 3, 14, 2).getTime() }, true, now)).toBe(
      `Needs you. No access. ${outboxStrings.next.needsYou} Last tried 14:02`,
    );
  });
});
