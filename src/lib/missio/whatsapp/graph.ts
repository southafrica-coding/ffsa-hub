// ────────────────────────────────────────────────────────────
// Missio WhatsApp — Graph API calls
// ────────────────────────────────────────────────────────────
// Server only. The token goes in the Authorization header and nowhere else:
// errors carry Meta's code and title, never the request.

import { GRAPH_BASE, type SendConfig } from "./config";
import { templateView, type GraphTemplate, type TemplateView } from "./rules";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GraphError = { code: number | null; title: string };

export type TextPayload = { kind: "text"; to: string; body: string };
export type TemplatePayload = {
  kind: "template";
  to: string;
  name: string;
  language: string;
  components: Array<{ type: "header" | "body"; parameters: Array<{ type: "text"; text: string; parameter_name?: string }> }>;
};

/** Reply buttons (at most 3). Only inside the 24-hour window. */
export type ButtonsPayload = { kind: "buttons"; to: string; body: string; buttons: Array<{ id: string; title: string }> };
/** A list (at most 10 rows) behind one button. Only inside the 24-hour window. */
export type ListPayload = {
  kind: "list";
  to: string;
  body: string;
  button: string;
  rows: Array<{ id: string; title: string; description?: string }>;
};

export type GraphPayload = TextPayload | TemplatePayload | ButtonsPayload | ListPayload;

/** The exact JSON posted to {phone number id}/messages. `to` is E.164 with the plus. */
export function messageBody(payload: GraphPayload): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: payload.to };
  if (payload.kind === "text") return { ...base, type: "text", text: { preview_url: false, body: payload.body } };
  if (payload.kind === "buttons") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: payload.body },
        action: { buttons: payload.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
      },
    };
  }
  if (payload.kind === "list") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: payload.body },
        action: {
          button: payload.button,
          sections: [
            {
              rows: payload.rows.map((r) => (r.description ? { id: r.id, title: r.title, description: r.description } : { id: r.id, title: r.title })),
            },
          ],
        },
      },
    };
  }
  const template: Record<string, unknown> = { name: payload.name, language: { code: payload.language } };
  if (payload.components.length > 0) template.components = payload.components;
  return { ...base, type: "template", template };
}

function graphError(json: unknown, status: number): GraphError {
  const err = (json as { error?: { code?: unknown; error_user_title?: unknown; message?: unknown } } | null)?.error;
  const code = typeof err?.code === "number" ? err.code : null;
  const title =
    (typeof err?.error_user_title === "string" && err.error_user_title) ||
    (typeof err?.message === "string" && err.message.slice(0, 200)) ||
    `WhatsApp answered ${status}.`;
  return { code, title };
}

export async function sendWhatsApp(
  config: SendConfig,
  payload: GraphPayload,
  fetcher: FetchLike = fetch
): Promise<{ ok: true; wamid: string } | { ok: false; error: GraphError }> {
  let res: Response;
  try {
    res = await fetcher(`${GRAPH_BASE}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(messageBody(payload)),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: { code: null, title: "WhatsApp couldn't be reached." } };
  }
  const json = (await res.json().catch(() => null)) as { messages?: Array<{ id?: unknown }> } | null;
  const wamid = json?.messages?.[0]?.id;
  if (!res.ok || typeof wamid !== "string" || !wamid) return { ok: false, error: graphError(json, res.status) };
  return { ok: true, wamid };
}

/** Approved templates on the WABA, as the composer shows them. Follows paging up to 5 pages. */
export async function listApprovedTemplates(
  config: SendConfig,
  fetcher: FetchLike = fetch
): Promise<{ ok: true; templates: TemplateView[] } | { ok: false; error: GraphError }> {
  const fields = "name,language,status,category,parameter_format,components";
  let url: string | null =
    `${GRAPH_BASE}/${encodeURIComponent(config.wabaId)}/message_templates?status=APPROVED&limit=100&fields=${fields}`;
  const out: TemplateView[] = [];
  for (let page = 0; url && page < 5; page += 1) {
    let res: Response;
    try {
      res = await fetcher(url, { headers: { Authorization: `Bearer ${config.accessToken}` }, cache: "no-store" });
    } catch {
      return { ok: false, error: { code: null, title: "WhatsApp couldn't be reached." } };
    }
    const json = (await res.json().catch(() => null)) as { data?: GraphTemplate[]; paging?: { next?: string } } | null;
    if (!res.ok || !json) return { ok: false, error: graphError(json, res.status) };
    for (const raw of json.data ?? []) {
      const view = templateView(raw);
      if (view) out.push(view);
    }
    const next = json.paging?.next;
    // Only follow Graph's own paging links.
    url = typeof next === "string" && next.startsWith(`${GRAPH_BASE}/`) ? next : null;
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
  return { ok: true, templates: out };
}
