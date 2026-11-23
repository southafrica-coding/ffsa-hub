// ────────────────────────────────────────────────────────────
// Missio WhatsApp — what a verified webhook POST does
// ────────────────────────────────────────────────────────────
// Runs only after the signature check. Stores inbound messages (once per
// wamid) and status updates (forward only), for the Missio number only.
// Media isn't downloaded in v1: the thread gets a placeholder like "[Photo]".
// Each newly stored inbound message comes back as a bot job; the route hands
// the jobs to the menu bot after the 200 (bot/schedule.ts). Nothing here
// calls Graph.

import { e164FromWaId } from "./phone";
import { isWebhookStatus, optChange, placeholderFor, previewOf } from "./rules";
import type { BotJob } from "./bot/types";
import type { WhatsAppStore } from "./store";

type WebhookMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

type WebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; error_data?: { details?: string } }>;
};

type WebhookValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
};

export type WebhookPayload = {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WebhookValue }> }>;
};

export type WebhookOutcome = { inbound: number; duplicates: number; statuses: number; ignored: number; jobs: BotJob[] };

const MAX_BODY = 4096;

function isoFromUnix(value: string | undefined, fallback: Date): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : fallback.toISOString();
}

const MAX_REPLY_ID = 256;

/**
 * The text a message shows in the thread, whether it's real text or a
 * placeholder, and — for a tapped button or list row — the reply id the
 * menu routes on. The title stays the body so the thread reads naturally.
 */
export function inboundContent(message: WebhookMessage): { kind: "text" | "placeholder"; body: string; replyId: string | null } {
  const rawId =
    message.type === "interactive" ? (message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id) : undefined;
  const replyId = typeof rawId === "string" && rawId.trim() ? rawId.trim().slice(0, MAX_REPLY_ID) : null;
  const text =
    message.type === "text"
      ? message.text?.body
      : message.type === "button"
        ? message.button?.text
        : message.type === "interactive"
          ? (message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title)
          : undefined;
  if (typeof text === "string" && text.trim()) return { kind: "text", body: text.slice(0, MAX_BODY), replyId };
  return { kind: "placeholder", body: placeholderFor(message.type), replyId };
}

export async function handleWebhook(
  payload: WebhookPayload,
  store: WhatsAppStore,
  options: { phoneNumberId: string; now?: Date }
): Promise<WebhookOutcome> {
  const now = options.now ?? new Date();
  const outcome: WebhookOutcome = { inbound: 0, duplicates: 0, statuses: 0, ignored: 0, jobs: [] };
  if (payload.object !== "whatsapp_business_account") return outcome;

  let orgId: string | null | undefined;
  const org = async () => {
    if (orgId === undefined) orgId = await store.missioOrgId();
    return orgId;
  };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== "messages" || !value) continue;
      // Another number on the same app is none of Missio's business.
      if (value.metadata?.phone_number_id !== options.phoneNumberId) {
        outcome.ignored += (value.messages?.length ?? 0) + (value.statuses?.length ?? 0);
        continue;
      }
      const missio = await org();
      if (!missio) throw new Error("[missio-whatsapp] Missio organisation not found");

      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        const name = contact.profile?.name?.trim();
        if (contact.wa_id && name) names.set(contact.wa_id, name.slice(0, 120));
      }

      for (const message of value.messages ?? []) {
        const e164 = e164FromWaId(message.from);
        if (!e164 || !message.from || !message.id) {
          outcome.ignored += 1;
          continue;
        }
        const thread = await store.ensureThread({
          orgId: missio,
          e164,
          waId: e164.slice(1),
          contactId: await store.matchContact(missio, e164),
          profileName: names.get(message.from) ?? null,
        });
        const content = inboundContent(message);
        // Typed words (and template quick-reply buttons) can opt out or in.
        // A tapped menu row can't: the menu's "Yes" answers a question, it
        // isn't START / YES.
        const opt = content.kind === "text" && message.type !== "interactive" ? optChange(content.body) : null;
        const at = isoFromUnix(message.timestamp, now);
        const saved = await store.insertInbound({
          orgId: missio,
          threadId: thread.id,
          wamid: message.id,
          kind: content.kind,
          waType: message.type ?? "unknown",
          body: content.body,
          at,
          optChange: opt,
          replyId: content.replyId,
        });
        if (!saved.inserted || !saved.id) {
          outcome.duplicates += 1;
          continue;
        }
        await store.bumpThread(thread.id, { messageId: saved.id, direction: "in", at, preview: previewOf(content.body), optChange: opt });
        outcome.inbound += 1;
        outcome.jobs.push({
          orgId: missio,
          threadId: thread.id,
          messageId: saved.id,
          wamid: message.id,
          at,
          kind: content.kind,
          text: content.kind === "text" ? content.body : null,
          replyId: content.replyId,
          optChange: opt,
          // Before this message: did START / YES just lift an opt-out?
          wasOptedOut: Boolean(thread.opted_out_at),
        });
      }

      for (const status of value.statuses ?? []) {
        if (!status.id || !isWebhookStatus(status.status)) {
          outcome.ignored += 1;
          continue;
        }
        const error = status.status === "failed" ? status.errors?.[0] : undefined;
        await store.recordStatus({
          orgId: missio,
          wamid: status.id,
          status: status.status,
          at: isoFromUnix(status.timestamp, now),
          errorCode: typeof error?.code === "number" ? error.code : null,
          errorTitle: error ? (error.error_data?.details ?? error.title ?? "Not delivered").slice(0, 300) : null,
        });
        outcome.statuses += 1;
      }
    }
  }
  return outcome;
}
