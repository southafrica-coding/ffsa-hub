// API contract for the Training tab's Today (T4). Pure: takes an ApiFetch.
//
//   GET  /api/mobile/training/today            this person's to-do list
//   POST /api/mobile/training/today/dismiss    tick an item off (or back on) for the week
//
// Built on the server from signals the Hub already has (check-ins, care
// flags, decisions, grades, references, fees) and read through RLS.

import { z } from "zod";

import type { ApiFetch, ApiFetchInit } from "@/lib/api";

type Init = Pick<ApiFetchInit, "signal">;

const targetSchema = z.union([
  z.object({ type: z.literal("student"), enrollmentId: z.string() }),
  z.object({ type: z.literal("students"), filter: z.enum(["needs_care", "no_checkin", "all"]).catch("all") }),
  z.object({ type: z.literal("web"), path: z.string() }),
]);
export type TodayTarget = z.infer<typeof targetSchema>;

export const todayItemSchema = z.object({
  key: z.string(),
  kind: z.string().catch("other"),
  severity: z.number().catch(3),
  title: z.string(),
  meta: z.string().catch(""),
  count: z.number().nullish().transform((v) => v ?? null),
  target: targetSchema.catch({ type: "web", path: "/schools" }),
  done: z.boolean().catch(false),
});
export type TodayItem = z.infer<typeof todayItemSchema>;

export const todaySchema = z.object({
  weekOf: z.string().catch(""),
  isoWeek: z.string().catch(""),
  items: z.array(z.unknown()).transform((rows) =>
    rows.flatMap((r) => {
      const p = todayItemSchema.safeParse(r);
      return p.success ? [p.data] : [];
    }),
  ),
  band: z.string().nullish().transform((v) => v ?? null),
  open: z.number().catch(0),
});
export type Today = z.infer<typeof todaySchema>;

export function getToday(apiFetch: ApiFetch, init?: Init): Promise<Today> {
  return apiFetch("/api/mobile/training/today", { ...init, schema: todaySchema });
}

export async function setTodayDone(apiFetch: ApiFetch, key: string, done: boolean): Promise<void> {
  await apiFetch("/api/mobile/training/today/dismiss", { method: "POST", body: { key, done } });
}

/** Apply a tick locally (optimistic): re-sort, move the band, recount. */
export function withDone(today: Today, key: string, done: boolean): Today {
  const items = today.items
    .map((i) => (i.key === key ? { ...i, done } : i))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.severity - b.severity);
  const band = items.find((i) => !i.done) ?? null;
  return { ...today, items, band: band?.key ?? null, open: items.filter((i) => !i.done).length };
}
