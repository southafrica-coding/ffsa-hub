// The app's one outbox, wired to the real network, storage and session.
//
// Receipt files go to the private `outreach-receipts` bucket exactly as the
// website uploads them: with the signed-in person's own Supabase client,
// path `${teamId}/${expenseId}/${Date.now()}_${name}`, upsert on. Then the
// API registers the file (POST /api/finance/outreach/receipts) so the
// server-side checks run. Expenses only ever go through the API.

import NetInfo from "@react-native-community/netinfo";
import { File } from "expo-file-system";

import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

import { classify, createExpense, registerReceipt } from "../api";

import { Outbox } from "./runner";
import { fileOutboxStorage } from "./store";

export const RECEIPTS_BUCKET = "outreach-receipts";

type StorageErrorLike = { message?: string; status?: number; statusCode?: string | number };

/** Storage errors: permission and size problems won't fix themselves; the rest retry. */
export function classifyUpload(err: unknown) {
  if (err instanceof Error && (err as Error & { permanent?: unknown }).permanent === true) {
    return { permanent: true, message: err.message };
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
  return classify(err);
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
  outbox ??= new Outbox({
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
    classify: classifyUpload,
    async getUserId() {
      const { data } = await supabase.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async isOnline() {
      const s = await NetInfo.fetch();
      // "Unknown" (null) counts as online: trying costs one failed request.
      return s.isConnected !== false && s.isInternetReachable !== false;
    },
    now: () => Date.now(),
  });
  return outbox;
}
