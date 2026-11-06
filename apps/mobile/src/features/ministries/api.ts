// API contract for Ministries. Pure: takes an ApiFetch, so tests pass a mock
// and the app passes the live one from @/lib/api-client.
//
//   GET   /api/mobile/ministries/access     may I open the list? (new)
//   GET   /api/mobile/ministries            the list I may see (new)
//   GET   /api/mobile/ministries/[id]       one ministry's team (new)
//   PATCH /api/ministries/[id]/members      approve a pending person (existing,
//                                           the website's own; checks again)
//
// Rosters are read on the server after the same checks as the website's
// /ministry pages; the phone never reads those tables itself. Parsed
// tolerantly (unknown fields ignored, optional ones may be missing) so the
// server can grow without breaking installed apps.

import { z } from "zod";

import { ApiError, type ApiFetch, type ApiFetchInit } from "@/lib/api";

import { strings } from "./strings";

type Init = Pick<ApiFetchInit, "signal">;

const nullableString = z.string().nullish().transform((v) => v || null);
const ids = z.array(z.string()).nullish().transform((v) => v ?? []);

const ministrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: nullableString,
  isActive: z.boolean().catch(true),
  ministryType: z.enum(["main", "part_time"]).catch("main"),
});

export const ministryListItemSchema = ministrySchema.extend({
  peopleCount: z.number().catch(0),
});

export const ministryListSchema = z.object({
  scope: z.enum(["all", "led"]).catch("led"),
  canCreate: z.boolean().catch(false),
  ministries: z.array(z.unknown()).transform((rows) =>
    // One odd row shouldn't hide the rest.
    rows.flatMap((r) => {
      const p = ministryListItemSchema.safeParse(r);
      return p.success ? [p.data] : [];
    }),
  ),
});

export const rosterMemberSchema = z.object({
  membershipId: z.string(),
  userId: nullableString,
  name: z.string().catch("Unknown"),
  email: nullableString,
  role: z.enum(["leader", "member"]).catch("member"),
  status: z.string().catch("active"),
  isPointLeader: z.boolean().catch(false),
  categoryIds: ids,
  pointLeaderCategoryIds: ids,
});

export const ministryDetailSchema = z.object({
  ministry: ministrySchema,
  canManage: z.boolean().catch(false),
  subcategories: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .nullish()
    .transform((v) => v ?? []),
  roster: z.array(z.unknown()).transform((rows) =>
    rows.flatMap((r) => {
      const p = rosterMemberSchema.safeParse(r);
      return p.success ? [p.data] : [];
    }),
  ),
});

export const accessSchema = z.object({ canView: z.boolean() });

export type MinistryListItem = z.infer<typeof ministryListItemSchema>;
export type MinistryList = z.infer<typeof ministryListSchema>;
export type RosterMember = z.infer<typeof rosterMemberSchema>;
export type MinistryDetail = z.infer<typeof ministryDetailSchema>;

export function getMinistriesAccess(apiFetch: ApiFetch, init?: Init) {
  return apiFetch("/api/mobile/ministries/access", { ...init, schema: accessSchema }).then((r) => r.canView);
}

export function getMinistries(apiFetch: ApiFetch, init?: Init) {
  return apiFetch("/api/mobile/ministries", { ...init, schema: ministryListSchema });
}

export function getMinistry(apiFetch: ApiFetch, id: string, init?: Init) {
  return apiFetch(`/api/mobile/ministries/${encodeURIComponent(id)}`, { ...init, schema: ministryDetailSchema });
}

/** Approve a pending membership through the website's own roster endpoint. */
export async function approveMember(apiFetch: ApiFetch, ministryId: string, membershipId: string): Promise<void> {
  await apiFetch(`/api/ministries/${encodeURIComponent(ministryId)}/members`, {
    method: "PATCH",
    body: { membership_id: membershipId },
  });
}

/** What to say when a load fails: forbidden and not-found get their own words. */
export function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "forbidden") return strings.common.forbidden;
    if (err.status === 404 || err.status === 400) return strings.common.notFound;
    if (err.kind === "network" || err.kind === "timeout") return strings.common.network;
  }
  return strings.common.generic;
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "forbidden";
}
