// Vehicle-check outbox hardening: repeat safety for photos (the upload route
// is not idempotent), classification, double taps and stored-shape checks.

import { ApiError } from "@/lib/api";

import { ServerRefusal, type BookingsFetch } from "../http";
import { BookingsOutbox, type QueueDeps, type QueueStorage } from "../outbox/runner";
import {
  discard,
  enqueue,
  hasTaggedFile,
  isQueueItem,
  newFormItem,
  newPhotoItems,
  taggedFileName,
  type PhotoItem,
  type QueueItem,
} from "../outbox/state";

jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { fetch: async () => ({ isConnected: true }) } }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("expo-file-system", () => ({}));

// eslint-disable-next-line import/first
import { classifySend, photoWasReceived } from "../outbox/live";

const META = { userId: "u1", bookingId: "b1", bookingName: "Airport run", inspectionKind: "collection" as const };

function photo(over: Partial<PhotoItem> = {}): PhotoItem {
  const [p] = newPhotoItems(META, "damage_photo", [{ localUri: "file:///p.jpg", fileName: "IMG_1.jpg", mimeType: "image/jpeg" }], 1000, () => "photo-1");
  return { ...p, ...over };
}

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
  let clock = 10_000;
  const deps: QueueDeps = {
    storage,
    uploadPhoto: jest.fn(async () => ({ ok: true })),
    sendForm: jest.fn(async () => ({ ok: true })),
    wasReceived: jest.fn(async () => false),
    classify: classifySend,
    isAlreadyRecorded: () => false,
    getUserId: async () => "u1",
    isOnline: async () => true,
    now: () => clock,
    ...over,
  };
  return { outbox: new BookingsOutbox(deps), deps, deleted, tick: (ms: number) => (clock += ms) };
}

describe("photo repeat safety (upload is not idempotent)", () => {
  it("a fresh photo is uploaded without a check", async () => {
    const t = setup();
    await t.outbox.add(photo());
    await t.outbox.process();
    expect(t.deps.wasReceived).not.toHaveBeenCalled();
    expect(t.deps.uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it("after a timeout, it looks for the photo on the booking before sending again", async () => {
    const t = setup({
      uploadPhoto: jest
        .fn()
        .mockRejectedValueOnce(new ApiError("timeout", "slow"))
        .mockResolvedValue({ ok: true }),
    });
    await t.outbox.add(photo());
    await t.outbox.process();
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "waiting", maybeSent: true });

    // Not there: send it again.
    t.tick(60_000);
    await t.outbox.process();
    expect(t.deps.wasReceived).toHaveBeenCalledTimes(1);
    expect(t.deps.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("already on the booking: done, without a second upload", async () => {
    const t = setup({ wasReceived: jest.fn(async () => true) });
    await t.outbox.add(photo({ maybeSent: true }));
    await t.outbox.process();
    expect(t.deps.uploadPhoto).not.toHaveBeenCalled();
    expect(t.outbox.getItems()).toEqual([]);
    expect(t.deleted).toEqual(["file:///p.jpg"]);
  });

  it("the check itself can't run (no signal): waits, nothing uploaded", async () => {
    const t = setup({
      wasReceived: jest.fn(async () => {
        throw new ApiError("network", "offline");
      }),
    });
    await t.outbox.add(photo({ maybeSent: true }));
    await t.outbox.process();
    expect(t.deps.uploadPhoto).not.toHaveBeenCalled();
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1, maybeSent: true });
  });

  it("killed mid-upload: the restart treats it as maybe-sent and checks first", async () => {
    const t = setup({ wasReceived: jest.fn(async () => true) });
    await t.deps.storage.write([photo({ status: "sending" })]);
    await t.outbox.init();
    await t.outbox.process();
    expect(t.deps.wasReceived).toHaveBeenCalled();
    expect(t.deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it("tags the uploaded name with the item id, and finds it again", () => {
    expect(taggedFileName("IMG_1.jpg", "abc")).toBe("IMG_1__abc.jpg");
    expect(taggedFileName("noext", "abc")).toBe("noext__abc");
    expect(taggedFileName(".jpg", "abc")).toBe("photo__abc.jpg");
    expect(hasTaggedFile(["x.jpg", null, "IMG_1__abc.jpg"], "abc")).toBe(true);
    expect(hasTaggedFile(["IMG_1__abd.jpg"], "abc")).toBe(false);
  });

  it("photoWasReceived reads the booking's files; a refusal means send again, no signal means wait", async () => {
    const files = (names: string[]) => jest.fn(async () => ({ files: names.map((file_name) => ({ file_name })) })) as unknown as BookingsFetch;
    const p = photo({ id: "abc" });
    const found = files(["IMG_1__abc.jpg"]);
    expect(await photoWasReceived(found, p)).toBe(true);
    expect((found as unknown as jest.Mock).mock.calls[0][0]).toBe("/api/vehicles/inspections/files?booking_id=b1");
    expect(await photoWasReceived(files(["other.jpg"]), p)).toBe(false);
    const forbidden = jest.fn(async () => {
      throw new ApiError("forbidden", "no", 403);
    }) as unknown as BookingsFetch;
    expect(await photoWasReceived(forbidden, p)).toBe(false);
    const offline = jest.fn(async () => {
      throw new ApiError("network", "offline");
    }) as unknown as BookingsFetch;
    await expect(photoWasReceived(offline, p)).rejects.toThrow("offline");
  });
});

describe("classification", () => {
  it("a session that ended waits instead of needing the person", () => {
    expect(classifySend(new ApiError("unauthenticated", "signed out", 401)).permanent).toBe(false);
  });

  it("busy server (429/408) retries; 5xx and no answer may have arrived", () => {
    expect(classifySend(new ApiError("http", "busy", 429))).toMatchObject({ permanent: false, ambiguous: false });
    expect(classifySend(new ApiError("http", "slow", 408))).toMatchObject({ permanent: false });
    expect(classifySend(new ApiError("http", "boom", 503))).toMatchObject({ permanent: false, ambiguous: true });
    expect(classifySend(new ApiError("timeout", "slow"))).toMatchObject({ permanent: false, ambiguous: true });
    expect(classifySend(new ApiError("network", "gone"))).toMatchObject({ permanent: false, ambiguous: true });
  });

  it("refusals need the person, with the server's own words", () => {
    expect(classifySend(new ServerRefusal("File must be 10 MB or smaller", 400, {}))).toEqual({ permanent: true, message: "File must be 10 MB or smaller" });
    expect(classifySend(new ApiError("http", "x", 422)).permanent).toBe(true);
    expect(classifySend(new ApiError("deactivated", "x", 403)).permanent).toBe(true);
  });
});

describe("queue state", () => {
  it("double taps: the same photo file or the same form is queued once", () => {
    const p = photo();
    expect(enqueue([p], { ...p, id: "photo-2" })).toHaveLength(1);
    const f = newFormItem(META, { kind: "collection", odometer: 5 }, 1, "f1");
    expect(enqueue([f], { ...f, id: "f2" })).toHaveLength(1);
    expect(enqueue([f], { ...f, id: "f2", payload: { kind: "collection", odometer: 6 } })).toHaveLength(2);
  });

  it("Remove is refused mid-send", () => {
    const p = photo({ status: "sending" });
    expect(discard([p], p.id)).toEqual({ items: [p], removed: [] });
  });

  it("stored-shape check", () => {
    expect(isQueueItem(photo())).toBe(true);
    expect(isQueueItem(newFormItem(META, { kind: "return" }, 1, "f"))).toBe(true);
    expect(isQueueItem({ ...photo(), localUri: 3 } as never)).toBe(false);
    expect(isQueueItem({ ...photo(), kind: "other" } as never)).toBe(false);
    expect(isQueueItem({ ...newFormItem(META, { kind: "return" }, 1, "f"), payload: null } as never)).toBe(false);
  });
});
