// /api/account/deletion-request, the same route the website's
// /legal/delete-account page uses. Every call is for the signed-in person
// only: the server never takes a user id.
//
//   GET    → { request: {...} | null, contactEmail }
//   POST   → 201 saved · 200 already open · 202 emailed but not saved
//            (recorded:false, still a success: a person has it) · 503 nothing
//            worked (email the office)
//   DELETE → 200 cancelled · 404 nothing open (treated as cancelled) ·
//            409 the Hub can't cancel it yet (email the office)

import { z } from "zod";

import { ApiError, type ApiFetch, type ApiFetchInit } from "@/lib/api";

import type { DeletionRequest } from "./logic";

export const DELETION_REQUEST_PATH = "/api/account/deletion-request";

const requestSchema = z.object({
  requestedAt: z.string(),
  reason: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export const getResponseSchema = z.object({
  request: requestSchema.nullish().transform((v) => v ?? null),
  contactEmail: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export const postResponseSchema = z.object({
  request: requestSchema,
  // Absent on the "already open" answer, which is always saved.
  recorded: z
    .boolean()
    .nullish()
    .transform((v) => v ?? true),
  contactEmail: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export type DeletionStatus = { request: DeletionRequest | null; contactEmail: string | null };

export async function getDeletionRequest(
  apiFetch: ApiFetch,
  init?: Pick<ApiFetchInit, "signal">,
): Promise<DeletionStatus> {
  const res = await apiFetch(DELETION_REQUEST_PATH, { ...init, schema: getResponseSchema });
  return {
    request: res.request ? { ...res.request, recorded: true } : null,
    contactEmail: res.contactEmail,
  };
}

/** Trims the reason and caps it at the server's 1000 characters. */
export function cleanReason(reason: string): string | null {
  const trimmed = reason.trim().slice(0, 1000);
  return trimmed ? trimmed : null;
}

export async function requestDeletion(apiFetch: ApiFetch, reason: string): Promise<DeletionStatus> {
  const res = await apiFetch(DELETION_REQUEST_PATH, {
    method: "POST",
    body: { confirm: true, reason: cleanReason(reason), source: "app" },
    schema: postResponseSchema,
  });
  return { request: { ...res.request, recorded: res.recorded }, contactEmail: res.contactEmail };
}

export async function cancelDeletion(apiFetch: ApiFetch): Promise<void> {
  try {
    await apiFetch(DELETION_REQUEST_PATH, { method: "DELETE" });
  } catch (err) {
    // Nothing open: it's already cancelled (or was handled), which is what
    // the person wanted to know.
    if (err instanceof ApiError && err.status === 404) return;
    throw err;
  }
}
