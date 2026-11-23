// ────────────────────────────────────────────────────────────
// Missio WhatsApp — sending one message from the Hub
// ────────────────────────────────────────────────────────────
// Server only, after the pastor check. In order:
//   1. settings present (else 503 not_configured)
//   2. opted out? refuse, no Graph call
//   3. free text only inside the 24-hour window; otherwise an approved
//      template, every blank filled
//   4. the outbound row is written first (pending), then Graph is called,
//      then the row gets Graph's wamid (accepted) or the error (failed)

import type { SendConfig } from "./config";
import { sendWhatsApp, type FetchLike } from "./graph";
import {
  fillTemplate,
  inServiceWindow,
  MAX_TEXT_LENGTH,
  previewOf,
  templateComponents,
  templateValuesProblem,
  type TemplateView,
} from "./rules";
import { WhatsAppNotInstalledError, type MessageRow, type WhatsAppStore } from "./store";
import type { WhatsAppErrorCode } from "./types";

export type SendTarget = { e164: string; contactId: string | null };

export type SendContent =
  | { kind: "text"; text: string }
  | { kind: "template"; name: string; language: string; values: Record<string, string> };

export type SendFailure = { ok: false; status: number; code: WhatsAppErrorCode; error: string };
export type SendSuccess = { ok: true; message: MessageRow; threadId: string };

export type SendDeps = {
  store: WhatsAppStore;
  config: SendConfig | null;
  loadTemplates: () => Promise<{ ok: true; templates: TemplateView[] } | { ok: false }>;
  fetcher?: FetchLike;
  now?: () => Date;
};

const fail = (status: number, code: WhatsAppErrorCode, error: string): SendFailure => ({ ok: false, status, code, error });

export const SEND_MESSAGES = {
  not_configured: "WhatsApp isn't switched on in the Hub yet.",
  not_installed: "WhatsApp isn't switched on in the Hub yet (database update 396 is waiting).",
  opted_out: "They've asked not to get WhatsApp messages from Missio. Nothing was sent.",
  template_required:
    "WhatsApp only allows a free reply for 24 hours after they last wrote. Pick an approved message instead.",
  template_unavailable: "That message isn't approved on WhatsApp, or the Hub can't send it yet.",
} as const;

export async function sendFromHub(
  deps: SendDeps,
  input: { orgId: string; userId: string; target: SendTarget; content: SendContent }
): Promise<SendSuccess | SendFailure> {
  const { store, config } = deps;
  const now = deps.now?.() ?? new Date();
  if (!config) return fail(503, "not_configured", SEND_MESSAGES.not_configured);

  try {
    const existing = await store.findThread(input.orgId, input.target.e164);
    if (existing?.opted_out_at) return fail(409, "opted_out", SEND_MESSAGES.opted_out);

    let body: string;
    let template: { view: TemplateView; values: Record<string, string> } | null = null;
    if (input.content.kind === "text") {
      body = input.content.text.trim();
      if (!body || body.length > MAX_TEXT_LENGTH) return fail(400, "invalid_input", "Write a message first (up to 4,096 characters).");
      if (!inServiceWindow(existing?.last_inbound_at, now)) return fail(409, "template_required", SEND_MESSAGES.template_required);
    } else {
      const wanted = input.content;
      const loaded = await deps.loadTemplates();
      if (!loaded.ok) return fail(502, "send_failed", "WhatsApp's approved messages didn't load. Nothing was sent.");
      const view = loaded.templates.find((t) => t.name === wanted.name && t.language === wanted.language);
      if (!view || view.blockedReason) return fail(400, "template_unavailable", SEND_MESSAGES.template_unavailable);
      const problem = templateValuesProblem(view, wanted.values);
      if (problem) return fail(400, "invalid_input", problem);
      template = { view, values: wanted.values };
      body = fillTemplate(view, wanted.values);
    }

    const thread = await store.ensureThread({
      orgId: input.orgId,
      e164: input.target.e164,
      waId: input.target.e164.slice(1),
      contactId: input.target.contactId,
      profileName: null,
    });
    // A STOP can land between the first read and now.
    if (thread.opted_out_at) return fail(409, "opted_out", SEND_MESSAGES.opted_out);

    const at = now.toISOString();
    const vars = template
      ? Object.fromEntries(template.view.variables.map((v) => [`${v.part}:${v.key}`, (template.values[`${v.part}:${v.key}`] ?? "").trim()]))
      : null;
    const pending = await store.insertOutbound({
      orgId: input.orgId,
      threadId: thread.id,
      kind: template ? "template" : "text",
      body,
      templateName: template?.view.name ?? null,
      templateLanguage: template?.view.language ?? null,
      templateVars: vars,
      sentBy: input.userId,
      at,
    });
    await store.bumpThread(thread.id, { messageId: pending.id, direction: "out", at, preview: previewOf(body), optChange: null });

    const result = await sendWhatsApp(
      config,
      template
        ? {
            kind: "template",
            to: input.target.e164,
            name: template.view.name,
            language: template.view.language,
            components: templateComponents(template.view, template.values),
          }
        : { kind: "text", to: input.target.e164, body },
      deps.fetcher
    );

    if (!result.ok) {
      const failed = await store.failOutbound(pending.id, result.error);
      return { ok: true, message: failed, threadId: thread.id };
    }
    const accepted = await store.acceptOutbound(pending.id, result.wamid);
    return { ok: true, message: accepted, threadId: thread.id };
  } catch (error) {
    if (error instanceof WhatsAppNotInstalledError) return fail(503, "not_installed", SEND_MESSAGES.not_installed);
    console.error("[missio-whatsapp] send failed", error instanceof Error ? error.message : "unknown");
    return fail(500, "server_error", "Something went wrong. Nothing was sent.");
  }
}
