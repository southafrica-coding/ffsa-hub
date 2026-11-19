// Workshop fields and links, as the Fleet app's providersView / providerModal show them.

import type { PROVIDER_FIELDS } from "@/lib/fleet/providers";

type Field = (typeof PROVIDER_FIELDS)[number];
export type Provider = { id: string } & Record<Field, string>;

/** The dialog's fields and labels, in the app's order (PFIELDS). */
export const PFIELDS: [Field, string][] = [
  ["name", "Name"],
  ["services", "Services"],
  ["phone", "Phone"],
  ["phone2", "Other phone"],
  ["email", "Email"],
  ["website", "Website"],
  ["address", "Address"],
  ["hours", "Hours"],
  ["notes", "Notes"],
];

/** What the provider routes take: every field, trimmed. */
export const providerBody = (values: Record<string, string | undefined>) =>
  Object.fromEntries(PFIELDS.map(([k]) => [k, (values[k] || "").trim()])) as Record<Field, string>;

/** "tel:" link: digits and a leading + only, as the app does. */
export const telHref = (phone: string) => "tel:" + phone.replace(/[^\d+]/g, "");

/** A website as typed ("motech.co.za") opens over https. */
export const siteHref = (w: string) => (/^https?:\/\//i.test(w) ? w : "https://" + w);
export const siteLabel = (w: string) => w.replace(/^https?:\/\//i, "");
