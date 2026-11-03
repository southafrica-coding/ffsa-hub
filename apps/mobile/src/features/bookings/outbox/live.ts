// The vehicle-check outbox wired to the real network, disk and session.
//
// Photos go exactly the way the website sends them: multipart to
// POST /api/vehicles/inspections/upload (file, booking_id, kind). The
// server puts them in the private `vehicle-inspections` bucket under
// `${bookingId}/${kind}/…` and records them, checking the person is the
// requester or a vehicle manager. The form goes to
// POST /api/vehicles/inspections, which emails the vehicle managers.

import NetInfo from "@react-native-community/netinfo";

import { supabase } from "@/lib/supabase";

import { isTransient, recordInspection, uploadInspectionPhoto, userMessage } from "../api";
import { bookingsFetch } from "../client";
import { ServerRefusal } from "../http";

import { BookingsOutbox } from "./runner";
import type { Failure } from "./state";
import { fileQueueStorage } from "./store";

export function classifySend(err: unknown): Failure {
  if (err instanceof Error && (err as Error & { permanent?: unknown }).permanent === true) {
    return { permanent: true, message: err.message };
  }
  return { permanent: !isTransient(err), message: userMessage(err) };
}

/** The route answers a second form for the same check with 409 "already recorded". */
export function isAlreadyRecorded(err: unknown): boolean {
  return err instanceof ServerRefusal && err.status === 409 && /already recorded/i.test(err.message);
}

let outbox: BookingsOutbox | null = null;

export function getBookingsOutbox(): BookingsOutbox {
  outbox ??= new BookingsOutbox({
    storage: fileQueueStorage,
    uploadPhoto: (p) =>
      uploadInspectionPhoto(bookingsFetch, {
        bookingId: p.bookingId,
        kind: p.photoKind,
        localUri: p.localUri,
        fileName: p.fileName,
        mimeType: p.mimeType,
      }),
    sendForm: (f) => recordInspection(bookingsFetch, f.payload),
    classify: classifySend,
    isAlreadyRecorded,
    async getUserId() {
      const { data } = await supabase.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async isOnline() {
      const s = await NetInfo.fetch();
      return s.isConnected !== false && s.isInternetReachable !== false;
    },
    now: () => Date.now(),
  });
  return outbox;
}
