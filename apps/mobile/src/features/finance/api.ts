// The website's outreach-finance API, as the phone uses it. Everything that
// changes money goes through here, never straight to the tables, so the
// server-side steps still run: the Slack "running low" cash alert after an
// expense changes (checkCashAlert), and the service-role steps for receipts
// (signed URLs, deleting the stored file). Each call carries the bearer
// token via apiFetch.

import { z } from "zod";

import { ApiError, type ApiFetch } from "@/lib/api";

import type { ExpensePayload } from "./expense-form";
import type { Failure } from "./outbox/state";
import { strings } from "./strings";
import { expenseSchema, receiptSchema } from "./types";

const EXPENSES = "/api/finance/outreach/expenses";
const RECEIPTS = "/api/finance/outreach/receipts";

const savedSchema = z.object({
  success: z.literal(true),
  data: expenseSchema,
  replayed: z.boolean().optional(),
});
const okSchema = z.object({ success: z.literal(true) }).passthrough();

/** POST with the id the app chose: a retry after a dropped connection returns the first row. */
export function createExpense(apiFetch: ApiFetch, id: string, payload: ExpensePayload) {
  return apiFetch(EXPENSES, { method: "POST", body: { id, ...payload }, schema: savedSchema });
}

export function updateExpense(apiFetch: ApiFetch, id: string, payload: ExpensePayload) {
  return apiFetch(EXPENSES, { method: "PUT", body: { id, ...payload }, schema: savedSchema });
}

export function deleteExpense(apiFetch: ApiFetch, id: string) {
  return apiFetch(`${EXPENSES}?id=${encodeURIComponent(id)}`, { method: "DELETE", schema: okSchema });
}

export async function listReceipts(apiFetch: ApiFetch, expenseId: string, init?: { signal?: AbortSignal }) {
  const res = await apiFetch(`${RECEIPTS}?expense_id=${encodeURIComponent(expenseId)}`, {
    ...init,
    schema: z.object({ data: z.array(receiptSchema).nullish().transform((v) => v ?? []) }),
  });
  return res.data;
}

export function registerReceipt(
  apiFetch: ApiFetch,
  r: { expense_id: string; file_path: string; file_name: string; file_size: number; mime_type: string },
) {
  return apiFetch(RECEIPTS, { method: "POST", body: r, schema: okSchema });
}

export function deleteReceipt(apiFetch: ApiFetch, id: string) {
  return apiFetch(`${RECEIPTS}?id=${encodeURIComponent(id)}`, { method: "DELETE", schema: okSchema });
}

/** 1 unit of `from` = rate ZAR (the web's exchange-rate route). */
export async function exchangeRateToZar(apiFetch: ApiFetch, from: string) {
  const res = await apiFetch(`/api/finance/outreach/exchange-rate?from=${encodeURIComponent(from)}&to=ZAR`, {
    schema: z.object({ rate: z.number().positive() }),
  });
  return res.rate;
}

// ── Errors in plain words ───────────────────────────────────────────────────

/** Whether a failed send is worth retrying by itself. */
export function classify(err: unknown): Failure {
  const message = userMessage(err);
  if (err instanceof ApiError) {
    switch (err.kind) {
      case "network":
      case "timeout":
      case "unauthenticated":
        return { permanent: false, message };
      case "http":
        return { permanent: (err.status ?? 500) < 500, message };
      default:
        return { permanent: true, message };
    }
  }
  return { permanent: false, message };
}

export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "forbidden") return strings.common.forbidden;
    if (err.kind === "unauthenticated" || err.kind === "deactivated") return strings.common.signedOut;
    if (err.kind === "http" && err.status === 400) {
      return "FFSA Hub couldn't save this: some details are missing or not right. Check the form and try again.";
    }
    if (err.kind === "http" && err.status === 409) {
      return "FFSA Hub already has a different record with this id. Remove this one and add the expense again.";
    }
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}

export function isForbidden(err: unknown) {
  return err instanceof ApiError && err.kind === "forbidden";
}

export function isAuthEnded(err: unknown) {
  return err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated");
}
