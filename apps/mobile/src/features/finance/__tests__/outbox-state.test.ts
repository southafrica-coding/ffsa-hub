import {
  MAX_ATTEMPTS,
  backoffMs,
  discard,
  enqueue,
  forTeam,
  markDone,
  markFailed,
  markFileUploaded,
  markSending,
  nextWakeAt,
  receiptPath,
  receiptsFor,
  recover,
  referencedFiles,
  retry,
  runnable,
  wakeAll,
} from "../outbox/state";

import { EXPENSE, TEAM, USER, expenseItem, receiptItem } from "../__fixtures__/fixtures";

const online = { now: 10_000, userId: USER, online: true };

describe("receiptPath", () => {
  it("follows the website's storage path rule", () => {
    expect(receiptPath("t1", "e1", "receipt.jpg", 1762160000000)).toBe("t1/e1/1762160000000_receipt.jpg");
  });
});

describe("runnable", () => {
  it("sends nothing offline or signed out", () => {
    const items = [expenseItem()];
    expect(runnable(items, { ...online, online: false })).toEqual([]);
    expect(runnable(items, { ...online, userId: null })).toEqual([]);
  });

  it("only sends the signed-in person's items", () => {
    expect(runnable([expenseItem({ userId: "someone-else" })], online)).toEqual([]);
  });

  it("holds a receipt back while its expense is still in the outbox", () => {
    const items = [receiptItem(), expenseItem()];
    expect(runnable(items, online).map((i) => i.id)).toEqual([EXPENSE]);
    expect(runnable(markDone(items, EXPENSE), online).map((i) => i.id)).toEqual(["r-1"]);
  });

  it("keeps a receipt back behind a failed expense too", () => {
    const items = [expenseItem({ status: "failed" }), receiptItem()];
    expect(runnable(items, online)).toEqual([]);
  });

  it("respects the backoff timer", () => {
    const items = [expenseItem({ nextAttemptAt: 20_000 })];
    expect(runnable(items, online)).toEqual([]);
    expect(runnable(items, { ...online, now: 20_000 })).toHaveLength(1);
  });

  it("sends oldest first, expenses before receipts", () => {
    const items = [
      receiptItem({ id: "r-new", expenseId: "other", createdAt: 5 }),
      receiptItem({ id: "r-old", expenseId: "other", createdAt: 1 }),
      expenseItem({ id: "e-2", createdAt: 9 }),
    ];
    expect(runnable(items, online).map((i) => i.id)).toEqual(["e-2", "r-old", "r-new"]);
  });
});

describe("transitions", () => {
  it("enqueue replaces an item with the same id instead of duplicating it", () => {
    const items = enqueue([expenseItem()], expenseItem({ lastError: "x" }));
    expect(items).toHaveLength(1);
    expect(items[0].lastError).toBe("x");
  });

  it("transient failures back off and keep the item waiting", () => {
    let items = markSending([expenseItem()], EXPENSE);
    expect(items[0].status).toBe("sending");
    items = markFailed(items, EXPENSE, { permanent: false, message: "offline" }, 10_000);
    expect(items[0]).toMatchObject({ status: "waiting", attempts: 1, nextAttemptAt: 10_000 + backoffMs(1), lastError: "offline" });
  });

  it("backoff doubles and caps at five minutes", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(30)).toBe(5 * 60_000);
  });

  it("permanent failures stop and wait for the person", () => {
    const items = markFailed([expenseItem()], EXPENSE, { permanent: true, message: "no permission" }, 10_000);
    expect(items[0]).toMatchObject({ status: "failed", lastError: "no permission" });
  });

  it("gives up retrying by itself after MAX_ATTEMPTS, but keeps the item", () => {
    let items = [expenseItem({ attempts: MAX_ATTEMPTS - 1 })];
    items = markFailed(items, EXPENSE, { permanent: false, message: "still offline" }, 0);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("failed");
  });

  it("retry makes a failed item runnable now and resets its count", () => {
    const items = retry([expenseItem({ status: "failed", attempts: 8, nextAttemptAt: 99_999 })], EXPENSE);
    expect(items[0]).toMatchObject({ status: "waiting", attempts: 0, nextAttemptAt: 0 });
  });

  it("wakeAll skips the backoff for waiting items only", () => {
    const items = wakeAll([expenseItem({ nextAttemptAt: 99_999 }), receiptItem({ status: "failed", nextAttemptAt: 5 })]);
    expect(items.map((i) => [i.status, i.nextAttemptAt])).toEqual([
      ["waiting", 0],
      ["failed", 5],
    ]);
  });

  it("recover puts anything left mid-send by a crash back to waiting", () => {
    expect(recover([expenseItem({ status: "sending" })])[0].status).toBe("waiting");
  });

  it("markFileUploaded remembers the file is in the bucket", () => {
    expect((markFileUploaded([receiptItem()], "r-1")[0] as { fileUploaded: boolean }).fileUploaded).toBe(true);
  });

  it("discarding an expense takes its receipts with it and reports what went", () => {
    const { items, removed } = discard([expenseItem(), receiptItem(), receiptItem({ id: "r-other", expenseId: "other" })], EXPENSE);
    expect(items.map((i) => i.id)).toEqual(["r-other"]);
    expect(removed.map((i) => i.id)).toEqual([EXPENSE, "r-1"]);
  });

  it("discarding a receipt leaves its expense", () => {
    const { items } = discard([expenseItem(), receiptItem()], "r-1");
    expect(items.map((i) => i.id)).toEqual([EXPENSE]);
  });
});

describe("what screens show", () => {
  const items = [expenseItem(), receiptItem(), receiptItem({ id: "r-2", teamId: "other-team", expenseId: "x" }), receiptItem({ id: "r-3", userId: "someone-else" })];

  it("groups a team's items for the signed-in person", () => {
    const t = forTeam(items, TEAM, USER);
    expect(t.expenses.map((i) => i.id)).toEqual([EXPENSE]);
    expect(t.receipts.map((i) => i.id)).toEqual(["r-1"]);
  });

  it("lists receipts waiting for one expense", () => {
    expect(receiptsFor(items, EXPENSE, USER).map((i) => i.id)).toEqual(["r-1"]);
  });

  it("knows which photo files are still needed", () => {
    expect(referencedFiles(items).has("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("nextWakeAt is the earliest waiting timer", () => {
    expect(nextWakeAt([expenseItem({ nextAttemptAt: 50 }), receiptItem({ nextAttemptAt: 20 })], USER)).toBe(20);
    expect(nextWakeAt([expenseItem({ status: "failed" })], USER)).toBeNull();
  });
});
