// The app's one finance outbox, wired to the real network, storage and session.
//
// Receipt files go to the private `outreach-receipts` bucket exactly as the
// website uploads them: with the signed-in person's own Supabase client,
// path `${teamId}/${expenseId}/${Date.now()}_${name}`, upsert on. Then the
// API registers the file (POST /api/finance/outreach/receipts) so the
// server-side checks run. Expenses only ever go through the API.

import NetInfo from "@react-native-community/netinfo";
import { File } from "expo-file-system";

import { ApiError, createApiFetch } from "@/lib/api";
import { isRetryableStatus } from "@/lib/outbox/backoff";
import { liveApiDeps, sessionUserId } from "@/lib/outbox/live-deps";
import type { Failure } from "@/lib/outbox/queue";
import { retryAfterRecorder } from "@/lib/outbox/retry-after";
import { isOnlineState } from "@/lib/outbox/use-pump";
import { supabase } from "@/lib/supabase";

import { classify, createExpense, registerReceipt } from "../api";

import { Outbox } from "./runner";
import { fileOutboxStorage } from "./store";

export const RECEIPTS_BUCKET = "outreach-receipts";

type StorageErrorLike = { message?: string; status?: number; statusCode?: string | number };

/**
 * Whether a failed send is worth retrying by itself. Permission and size
 * problems won't fix themselves; a session that ended, a timeout, a busy
 * server (408/429/5xx) or no connection will.
 */
export function classifyUpload(err: unknown): Failure {
  if (err instanceof Error && (err as Error & { permanent?: unknown }).permanent === true) {
    return { permanent: true, message: err.message };
  }
  if (err instanceof ApiError && err.kind === "http" && isRetryableStatus(err.status)) {
    return { permanent: false, message: err.message, ambiguous: true };
  }
  const e = (err ?? {}) as StorageErrorLike;
  const status = Number(e.status ?? e.statusCode ?? 0);
  const msg = e.message ?? "";
  if (status === 403 || /row-level security|unauthori[sz]ed|not allowed/i.test(msg)) {
    return { permanent: true, message: "You don't have permission to add receipts to this team. Ask your team leader." };
  }
  if (status === 413 || /too large|payload/i.test(msg)) {
    return { permanent: true, message: "This photo is too large to upload. Remove it and take it again." };
  }
  const base = classify(err);
  const ambiguous = err instanceof ApiError ? err.kind === "timeout" || err.kind === "network" : !base.permanent;
  return { ...base, ambiguous };
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

let outbox: Outbox | null = null;

export function getOutbox(): Outbox {
  if (outbox) return outbox;
  const retryAfter = retryAfterRecorder();
  const apiFetch = createApiFetch(liveApiDeps(retryAfter.fetchImpl));
  outbox = new Outbox({
    storage: fileOutboxStorage,
    createExpense: (id, payload) => createExpense(apiFetch, id, payload),
    registerReceipt: (r) => registerReceipt(apiFetch, r),
    async uploadFile(filePath, localUri, mimeType) {
      const bytes = await new File(localUri).arrayBuffer();
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(filePath, bytes, {
        contentType: mimeType,
        upsert: true,
      });
      if (error) {
        const e = error as StorageErrorLike;
        throw new UploadError(error.message, Number(e.status ?? e.statusCode ?? 0) || undefined);
      }
    },
    classify: (err) => ({ ...classifyUpload(err), retryAfterMs: retryAfter.take() }),
    getUserId: sessionUserId,
    async isOnline() {
      return isOnlineState(await NetInfo.fetch());
    },
    now: () => Date.now(),
    random: () => Math.random(),
  });
  return outbox;
}
