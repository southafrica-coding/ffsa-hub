import { ApiError } from "@/lib/api";

import { ServerRefusal } from "../http";
import { BookingsOutbox, PermanentError, type QueueDeps, type QueueStorage } from "../outbox/runner";
import {
  discard,
  formQueued,
  markFailed,
  MAX_ATTEMPTS,
  newFormItem,
  newPhotoItems,
  photoCounts,
  recover,
  retry,
  runnable,
  type QueueItem,
} from "../outbox/state";

jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { fetch: async () => ({ isConnected: true }) } }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("expo-file-system", () => ({}));

// classifySend / isAlreadyRecorded live with the real wiring; import after the mocks.
// eslint-disable-next-line import/first
import { classifySend, isAlreadyRecorded } from "../outbox/live";

const META = { userId: "u1", bookingId: "b1", bookingName: "Airport run", inspectionKind: "collection" as const };
let n = 0;
const id = () => `id-${++n}`;

function photos(count = 1, kind: "damage_photo" | "license" = "damage_photo", now = 1000) {
  return newPhotoItems(META, kind, Array.from({ length: count }, (_, i) => ({ localUri: `file:///p${i}.jpg`, fileName: `p${i}.jpg`, mimeType: "image/jpeg" })), now, id);
}

describe("queue state", () => {
  it("new items wait, in order", () => {
    const [a, b] = photos(2);
    expect(a).toMatchObject({ kind: "photo", status: "waiting", attempts: 0, userId: "u1", photoKind: "damage_photo" });
    expect(b.createdAt).toBe(a.createdAt + 1);
    const f = newFormItem(META, { kind: "collection" }, 5000, "f1");
    expect(f).toMatchObject({ kind: "form", id: "f1", status: "waiting", createdAt: 5000 });
  });

  it("only this person's due items run, only online", () => {
    const [a] = photos();
    const other = { ...photos()[0], userId: "someone-else" };
    const later = { ...photos()[0], nextAttemptAt: 9_999 };
    const items: QueueItem[] = [later, other, a];
    expect(runnable(items, { now: 2000, userId: "u1", online: true }).map((i) => i.id)).toEqual([a.id]);
    expect(runnable(items, { now: 2000, userId: "u1", online: false })).toEqual([]);
    expect(runnable(items, { now: 2000, userId: null, online: true })).toEqual([]);
  });

  it("backs off on transient failures, stops on permanent ones or after MAX_ATTEMPTS", () => {
    const [a] = photos();
    let items: QueueItem[] = [a];
    items = markFailed(items, a.id, { permanent: false, message: "offline" }, 0);
    expect(items[0]).toMatchObject({ status: "waiting", attempts: 1, lastError: "offline" });
    expect(items[0].nextAttemptAt).toBeGreaterThan(0);
    items = markFailed(items, a.id, { permanent: true, message: "too big" }, 0);
    expect(items[0].status).toBe("failed");
    let c: QueueItem[] = [{ ...a, attempts: MAX_ATTEMPTS - 1 }];
    c = markFailed(c, a.id, { permanent: false, message: "x" }, 0);
    expect(c[0].status).toBe("failed");
    expect(retry(c, a.id)[0]).toMatchObject({ status: "waiting", attempts: 0, nextAttemptAt: 0 });
  });

  it("a crash mid-send goes back to waiting; discard removes only that item", () => {
    const [a, b] = photos(2);
    expect(recover([{ ...a, status: "sending" }])[0].status).toBe("waiting");
    expect(discard([a, b], a.id)).toEqual({ items: [b], removed: [a] });
  });

  it("counts photos per check and knows when a form is waiting", () => {
    const items: QueueItem[] = [...photos(2, "license"), ...photos(1), newFormItem(META, { kind: "collection" }, 1, "f")];
    expect(photoCounts(items, "b1", "collection", "u1")).toEqual({ license: 2, damage_photo: 1 });
    expect(photoCounts(items, "b1", "return", "u1")).toEqual({});
    expect(formQueued(items, "b1", "collection", "u1")).toBe(true);
    expect(formQueued(items, "b1", "return", "u1")).toBe(false);
  });
});

describe("the runner", () => {
  function setup(over: Partial<QueueDeps> = {}) {
    let disk: QueueItem[] = [];
    const deleted: string[] = [];
    const storage: QueueStorage = {
      read: async () => disk,
      write: async (items) => {
        disk = items;
      },
      deleteFile: (uri) => {
        deleted.push(uri);
      },
      fileExists: () => true,
      listFiles: () => [],
    };
    const deps: QueueDeps = {
      storage,
      uploadPhoto: jest.fn(async () => ({ ok: true })),
      sendForm: jest.fn(async () => ({ ok: true })),
      classify: classifySend,
      isAlreadyRecorded,
      getUserId: async () => "u1",
      isOnline: async () => true,
      now: () => 10_000,
      ...over,
    };
    return { outbox: new BookingsOutbox(deps), deps, disk: () => disk, deleted };
  }

  it("sends photos and the form, then forgets them (and deletes the photo files)", async () => {
    const t = setup();
    const [p] = photos();
    await t.outbox.add(p, newFormItem(META, { kind: "collection" }, 2000, "f1"));
    await t.outbox.process();
    expect(t.deps.uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: p.id }));
    expect(t.deps.sendForm).toHaveBeenCalledTimes(1);
    expect(t.outbox.getItems()).toEqual([]);
    expect(t.disk()).toEqual([]);
    expect(t.deleted).toEqual([p.localUri]);
  });

  it("offline: everything stays on the phone, waiting", async () => {
    const t = setup({ isOnline: async () => false });
    await t.outbox.add(...photos());
    await t.outbox.process();
    expect(t.deps.uploadPhoto).not.toHaveBeenCalled();
    expect(t.outbox.getItems()[0].status).toBe("waiting");
  });

  it("a dropped connection is retried later; a refusal waits for the person", async () => {
    const t = setup({
      uploadPhoto: jest.fn(async () => {
        throw new ApiError("network", "Couldn't reach FFSA Hub.");
      }),
      sendForm: jest.fn(async () => {
        throw new ServerRefusal("vehicle_booking_id is required", 400, {});
      }),
    });
    await t.outbox.add(...photos(), newFormItem(META, { kind: "collection" }, 2000, "f1"));
    await t.outbox.process();
    const [photo, form] = t.outbox.getItems();
    expect(photo).toMatchObject({ status: "waiting", attempts: 1 });
    expect(photo.nextAttemptAt).toBeGreaterThan(10_000);
    expect(form).toMatchObject({ status: "failed", lastError: "vehicle_booking_id is required" });
  });

  it("a 409 'already recorded' on the form means the first try got through", async () => {
    const t = setup({
      sendForm: jest.fn(async () => {
        throw new ServerRefusal("A collection inspection is already recorded for this booking.", 409, {});
      }),
    });
    await t.outbox.add(newFormItem(META, { kind: "collection" }, 2000, "f1"));
    await t.outbox.process();
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("a photo whose file is gone fails for good, with a next step", async () => {
    const t = setup();
    t.deps.storage.fileExists = () => false;
    await t.outbox.add(...photos());
    await t.outbox.process();
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "failed", lastError: expect.stringMatching(/take the photo again/) });
  });

  it("someone else signed in: nothing of mine is sent", async () => {
    const t = setup({ getUserId: async () => "u2" });
    await t.outbox.add(...photos());
    await t.outbox.process();
    expect(t.deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it("classification", () => {
    expect(classifySend(new PermanentError("gone"))).toEqual({ permanent: true, message: "gone" });
    expect(classifySend(new ApiError("timeout", "slow")).permanent).toBe(false);
    expect(classifySend(new ApiError("forbidden", "no", 403)).permanent).toBe(true);
    expect(isAlreadyRecorded(new ServerRefusal("A return inspection is already recorded for this booking.", 409, {}))).toBe(true);
    expect(isAlreadyRecorded(new ServerRefusal("Booking not found", 404, {}))).toBe(false);
  });
});
