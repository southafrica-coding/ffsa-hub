// The vehicle-check outbox wired to the real network, disk and session.
//
// Photos go exactly the way the website sends them: multipart to
// POST /api/vehicles/inspections/upload (file, booking_id, kind). The
// server puts them in the private `vehicle-inspections` bucket under
// `${bookingId}/${kind}/…` and records them, checking the person is the
// requester or a vehicle manager. The form goes to
// POST /api/vehicles/inspections, which emails the vehicle managers.
//
// The outbox has its own bookingsFetch (same session and rules as
// ../client.ts) so a server's Retry-After reaches the retry timer.

import NetInfo from "@react-native-community/netinfo";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import { isRetryableStatus } from "@/lib/outbox/backoff";
import { liveApiDeps, sessionUserId } from "@/lib/outbox/live-deps";
import { retryAfterRecorder } from "@/lib/outbox/retry-after";
import { isOnlineState } from "@/lib/outbox/use-pump";

import { isTransient, recordInspection, uploadInspectionPhoto, userMessage } from "../api";
import { createBookingsFetch, ServerRefusal, type BookingsFetch } from "../http";

import { BookingsOutbox } from "./runner";
import { hasTaggedFile, taggedFileName, type Failure, type PhotoItem } from "./state";
import { fileQueueStorage } from "./store";

export function classifySend(err: unknown): Failure {
  if (err instanceof Error && (err as Error & { permanent?: unknown }).permanent === true) {
    return { permanent: true, message: err.message };
  }
  const message = userMessage(err);
  if (err instanceof ApiError) {
    // The session ended: the app is on its way to the sign-in screen. The
    // item waits (it only sends for its owner) instead of needing the person.
    if (err.kind === "unauthenticated") return { permanent: false, message };
    // No answer, or the server stumbled: the request may have got there.
    if (err.kind === "network" || err.kind === "timeout") return { permanent: false, message, ambiguous: true };
    if (err.kind === "http" && isRetryableStatus(err.status)) return { permanent: false, message, ambiguous: (err.status ?? 500) >= 500 };
  }
  return { permanent: !isTransient(err), message };
}

/** The route answers a second form for the same check with 409 "already recorded". */
export function isAlreadyRecorded(err: unknown): boolean {
  return err instanceof ServerRefusal && err.status === 409 && /already recorded/i.test(err.message);
}

const filesSchema = z.object({ files: z.array(z.object({ file_name: z.string().nullish() }).passthrough()).nullish() });

/**
 * Is a photo whose last try may have arrived already on the booking? Looks
 * for the item's id in the stored file names (GET
 * /api/vehicles/inspections/files, the web's own list). If the list can't
 * be read for a reason that won't pass (no access, not found), the photo is
 * sent again: a possible duplicate photo beats a lost one.
 */
export async function photoWasReceived(fetch: BookingsFetch, item: PhotoItem): Promise<boolean> {
  try {
    const res = await fetch(`/api/vehicles/inspections/files?booking_id=${encodeURIComponent(item.bookingId)}`, { schema: filesSchema });
    return hasTaggedFile((res.files ?? []).map((f) => f.file_name), item.id);
  } catch (err) {
    if (classifySend(err).permanent) return false;
    throw err;
  }
}

let outbox: BookingsOutbox | null = null;

export function getBookingsOutbox(): BookingsOutbox {
  if (outbox) return outbox;
  const retryAfter = retryAfterRecorder();
  const fetch = createBookingsFetch(liveApiDeps(retryAfter.fetchImpl));
  outbox = new BookingsOutbox({
    storage: fileQueueStorage,
    uploadPhoto: (p) =>
      uploadInspectionPhoto(fetch, {
        bookingId: p.bookingId,
        kind: p.photoKind,
        localUri: p.localUri,
        fileName: taggedFileName(p.fileName, p.id),
        mimeType: p.mimeType,
      }),
    sendForm: (f) => recordInspection(fetch, f.payload),
    wasReceived: (p) => photoWasReceived(fetch, p),
    classify: (err) => ({ ...classifySend(err), retryAfterMs: retryAfter.take() }),
    isAlreadyRecorded,
    getUserId: sessionUserId,
    async isOnline() {
      return isOnlineState(await NetInfo.fetch());
    },
    now: () => Date.now(),
    random: () => Math.random(),
  });
  return outbox;
}
