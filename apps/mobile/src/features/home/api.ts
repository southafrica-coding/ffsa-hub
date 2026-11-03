// GET /api/notifications and POST /api/notifications/read (the website's
// routes, bearer-aware). Contract: src/lib/notifications-feed.ts in the web.

import { z } from "zod";

import type { ApiFetch, ApiFetchInit } from "@/lib/api";

// Tolerant, like meSchema: unknown fields ignored, new kinds allowed, and a
// single malformed item is dropped rather than failing the whole feed.
const nullableString = z.string().nullish().transform((v) => v ?? null);

export const feedItemSchema = z.object({
  key: z.string().min(1),
  kind: z.string().catch("other"),
  title: z.string(),
  body: z.string().nullish().transform((v) => v ?? ""),
  href: nullableString,
  read: z.boolean().catch(false),
  createdAt: nullableString,
});

export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedSchema = z.object({
  items: z
    .array(z.unknown())
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = feedItemSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  unreadCount: z.number().nullish(),
});

export function getFeed(apiFetch: ApiFetch, init?: Pick<ApiFetchInit, "signal">) {
  return apiFetch("/api/notifications", { ...init, schema: feedSchema });
}

// The server caps a request at 200 keys.
const MAX_KEYS = 200;

export async function markRead(apiFetch: ApiFetch, keys: string[]) {
  for (let i = 0; i < keys.length; i += MAX_KEYS) {
    await apiFetch("/api/notifications/read", { method: "POST", body: { keys: keys.slice(i, i + MAX_KEYS) } });
  }
}
