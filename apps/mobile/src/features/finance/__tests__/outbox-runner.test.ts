import { ApiError } from "@/lib/api";

import { classify } from "../api";
import { Outbox, PermanentError, type OutboxDeps } from "../outbox/runner";
import type { OutboxItem } from "../outbox/state";
import { EXPENSE, USER, expenseItem, memoryStorage, receiptItem } from "../__fixtures__/fixtures";

function setup(initial: OutboxItem[] = [], files: string[] = ["file:///docs/finance-outbox/r-1.jpg"]) {
  const storage = memoryStorage(initial, files);
  const net = { online: true };
  let clock = 1_000_000;
  const deps: OutboxDeps = {
    storage,
    createExpense: jest.fn(async () => ({})),
    registerReceipt: jest.fn(async () => ({})),
    uploadFile: jest.fn(async () => {}),
    classify: (err) => (err instanceof PermanentError ? { permanent: true, message: err.message } : classify(err)),
    getUserId: async () => USER,
    isOnline: async () => net.online,
    now: () => clock,
  };
  const outbox = new Outbox(deps);
  return { outbox, deps, storage, net, tick: (ms: number) => (clock += ms) };
}

describe("Outbox runner", () => {
  it("sends the expense, then uploads and registers its receipt, then forgets both", async () => {
    const { outbox, deps, storage } = setup();
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();

    expect(deps.createExpense).toHaveBeenCalledWith(EXPENSE, expect.objectContaining({ description: "Bread and milk" }));
    expect(deps.uploadFile).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^.+/${EXPENSE}/\\d+_receipt\\.jpg$`)), "file:///docs/finance-outbox/r-1.jpg", "image/jpeg");
    expect(deps.registerReceipt).toHaveBeenCalledWith(expect.objectContaining({ expense_id: EXPENSE, file_name: "receipt.jpg", mime_type: "image/jpeg" }));
    expect(outbox.getItems()).toEqual([]);
    expect(storage.saved).toEqual([]);
    // The photo is deleted from the phone only once it's on the server.
    expect(storage.fileExists("file:///docs/finance-outbox/r-1.jpg")).toBe(false);
  });

  it("writes the item to disk before trying to send it", async () => {
    const { outbox, deps, storage } = setup();
    (deps.createExpense as jest.Mock).mockImplementation(async () => {
      expect(storage.saved.map((i) => i.id)).toContain(EXPENSE);
      return {};
    });
    await outbox.add(expenseItem());
    await outbox.process();
    expect(deps.createExpense).toHaveBeenCalled();
  });

  it("sends nothing while offline, and everything once back online", async () => {
    const { outbox, deps, net } = setup();
    net.online = false;
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();
    expect(deps.createExpense).not.toHaveBeenCalled();
    expect(outbox.getItems()).toHaveLength(2);

    net.online = true;
    await outbox.wake();
    expect(outbox.getItems()).toEqual([]);
  });

  it("a network failure keeps the photo and retries with backoff, never losing it", async () => {
    const { outbox, deps, storage, tick } = setup();
    (deps.createExpense as jest.Mock).mockRejectedValueOnce(new ApiError("network", "Couldn't reach FFSA Hub."));
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();

    const [exp, rec] = outbox.getItems();
    expect(exp).toMatchObject({ status: "waiting", attempts: 1, lastError: "Couldn't reach FFSA Hub." });
    expect(rec.status).toBe("waiting");
    expect(storage.fileExists("file:///docs/finance-outbox/r-1.jpg")).toBe(true);

    // Not yet due: nothing happens.
    await outbox.process();
    expect(deps.createExpense).toHaveBeenCalledTimes(1);

    tick(2_001);
    await outbox.process();
    expect(deps.createExpense).toHaveBeenCalledTimes(2);
    expect(outbox.getItems()).toEqual([]);
  });

  it("retries an expense with the SAME id, so the server can recognise it (no double expense)", async () => {
    const { outbox, deps, tick } = setup();
    (deps.createExpense as jest.Mock).mockRejectedValueOnce(new ApiError("timeout", "The server took too long."));
    await outbox.add(expenseItem());
    await outbox.process();
    tick(5_000);
    await outbox.process();
    const ids = (deps.createExpense as jest.Mock).mock.calls.map((c) => c[0]);
    expect(ids).toEqual([EXPENSE, EXPENSE]);
  });

  it("a permission refusal stops retrying and waits for the person", async () => {
    const { outbox, deps, tick } = setup();
    (deps.createExpense as jest.Mock).mockRejectedValue(new ApiError("forbidden", "You don't have access to this.", 403));
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();
    tick(60 * 60_000);
    await outbox.process();
    expect(deps.createExpense).toHaveBeenCalledTimes(1);
    expect(outbox.getItems().map((i) => i.status)).toEqual(["failed", "waiting"]);
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it("after the file is in the bucket, a retry only re-registers it (same path, no re-upload)", async () => {
    const { outbox, deps, tick } = setup();
    (deps.registerReceipt as jest.Mock).mockRejectedValueOnce(new ApiError("network", "offline"));
    await outbox.add(receiptItem({ expenseId: "already-on-server" }));
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ fileUploaded: true, status: "waiting" });

    tick(3_000);
    await outbox.process();
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.registerReceipt).toHaveBeenCalledTimes(2);
    const paths = (deps.registerReceipt as jest.Mock).mock.calls.map((c) => c[0].file_path);
    expect(new Set(paths).size).toBe(1);
  });

  it("a photo that vanished from the phone is a permanent failure with a plain message", async () => {
    const { outbox } = setup([], []);
    await outbox.add(receiptItem({ expenseId: "already-on-server" }));
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "failed", lastError: expect.stringMatching(/no longer on the phone/) });
  });

  it("Retry sends a failed item again; Remove deletes it and its photo", async () => {
    const { outbox, deps, storage } = setup();
    (deps.createExpense as jest.Mock).mockRejectedValueOnce(new ApiError("http", "Bad request", 400));
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();
    expect(outbox.getItems()[0].status).toBe("failed");

    await outbox.retry(EXPENSE);
    await outbox.process();
    expect(outbox.getItems()).toEqual([]);

    await outbox.add(receiptItem({ id: "r-9", expenseId: "x", localUri: "file:///docs/finance-outbox/r-1.jpg" }));
    (deps.registerReceipt as jest.Mock).mockRejectedValue(new ApiError("forbidden", "no", 403));
    storage.files.set("file:///docs/finance-outbox/r-1.jpg", 0);
    await outbox.process();
    await outbox.discard("r-9");
    expect(outbox.getItems()).toEqual([]);
    expect(storage.fileExists("file:///docs/finance-outbox/r-1.jpg")).toBe(false);
  });

  it("discard can keep the photo files (the form still holds them)", async () => {
    const { outbox, storage } = setup();
    await outbox.add(expenseItem(), receiptItem());
    await outbox.discard(EXPENSE, { keepFiles: true });
    expect(outbox.getItems()).toEqual([]);
    expect(storage.fileExists("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("only sends the signed-in person's items", async () => {
    const { outbox, deps } = setup();
    await outbox.add(expenseItem({ userId: "previous-user" }));
    await outbox.process();
    expect(deps.createExpense).not.toHaveBeenCalled();
    expect(outbox.getItems()).toHaveLength(1);
  });

  it("after a restart, picks up what was left (including anything mid-send)", async () => {
    const { outbox, deps } = setup([expenseItem({ status: "sending" })]);
    await outbox.process();
    expect(deps.createExpense).toHaveBeenCalledTimes(1);
    expect(outbox.getItems()).toEqual([]);
  });

  it("concurrent process() calls share one run (no double send)", async () => {
    const { outbox, deps } = setup();
    let release!: () => void;
    (deps.createExpense as jest.Mock).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await outbox.add(expenseItem());
    const a = outbox.process();
    const b = outbox.process();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([a, b]);
    expect(deps.createExpense).toHaveBeenCalledTimes(1);
  });

  it("tidies away draft photos nobody saved after a day, never queued ones", async () => {
    const storage = memoryStorage([receiptItem()], []);
    storage.files.set("file:///docs/finance-outbox/r-1.jpg", 0);
    storage.files.set("file:///docs/finance-outbox/abandoned.jpg", 0);
    storage.files.set("file:///docs/finance-outbox/fresh-draft.jpg", 1_000_000 + 24 * 60 * 60_000 - 60_000);
    const outbox = new Outbox({
      storage,
      createExpense: jest.fn(),
      registerReceipt: jest.fn(),
      uploadFile: jest.fn(),
      classify,
      getUserId: async () => null,
      isOnline: async () => false,
      now: () => 1_000_000 + 24 * 60 * 60_000,
    });
    await outbox.init();
    expect([...storage.files.keys()].sort()).toEqual(["file:///docs/finance-outbox/fresh-draft.jpg", "file:///docs/finance-outbox/r-1.jpg"]);
  });

  it("tells subscribers about every change", async () => {
    const { outbox } = setup();
    const seen: number[] = [];
    outbox.subscribe(() => seen.push(outbox.getItems().length));
    await outbox.add(expenseItem());
    await outbox.process();
    expect(seen[seen.length - 1]).toBe(0);
    expect(Math.max(...seen)).toBe(1);
  });
});
