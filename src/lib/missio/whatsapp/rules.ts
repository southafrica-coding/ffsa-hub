// ────────────────────────────────────────────────────────────
// Missio WhatsApp — the rules
// ────────────────────────────────────────────────────────────
// Client-safe and pure, so the composer and the send route agree and the
// tests can pin each rule.
//
//   Window     WhatsApp allows a free reply only for 24 hours after the
//              person last wrote to us. Only an INBOUND message opens it;
//              our own messages never do.
//   Statuses   accepted → sent → delivered → read, or failed. A status
//              never moves backwards, and failed is final.
//   Opt-out    STOP (or UNSUBSCRIBE) from them stops every send. Only a later
//              START (or YES) from them lifts it; a pastor can't override.
//   Templates  Outside the window only an APPROVED template can be sent.
//              v1 fills text variables in the header and body; templates
//              with media headers or button variables are listed but
//              can't be sent from the Hub yet.

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Inside the 24-hour customer-service window? Strictly less than 24 hours since their last message. */
export function inServiceWindow(lastInboundAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const at = Date.parse(lastInboundAt);
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  // A clock a few seconds ahead of Meta's still counts as "just now".
  return age > -5 * 60 * 1000 && age < SERVICE_WINDOW_MS;
}

/** When the free-reply window closes, or null when it's closed already. */
export function serviceWindowEndsAt(lastInboundAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!lastInboundAt || !inServiceWindow(lastInboundAt, now)) return null;
  return new Date(Date.parse(lastInboundAt) + SERVICE_WINDOW_MS).toISOString();
}

// ── Statuses ──────────────────────────────────────────────

export const OUTBOUND_STATUSES = ["pending", "accepted", "sent", "delivered", "read", "failed"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];
export type MessageStatus = OutboundStatus | "received";

const RANK: Record<Exclude<OutboundStatus, "failed">, number> = { pending: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };

/** Webhook statuses we store. Anything else (deleted, warning, …) is ignored. */
export function isWebhookStatus(value: unknown): value is "sent" | "delivered" | "read" | "failed" {
  return value === "sent" || value === "delivered" || value === "read" || value === "failed";
}

/**
 * The current statuses a message may move from, to `next`. Used as an
 * `IN (...)` filter on the UPDATE, so the check and the write are one step.
 * failed only replaces a status that hasn't reached the phone yet.
 */
export function statusesThatCanBecome(next: OutboundStatus): OutboundStatus[] {
  if (next === "failed") return ["pending", "accepted", "sent"];
  const rank = RANK[next];
  return (Object.keys(RANK) as Array<keyof typeof RANK>).filter((status) => RANK[status] < rank);
}

export function canMoveStatus(current: OutboundStatus, next: OutboundStatus): boolean {
  return statusesThatCanBecome(next).includes(current);
}

/** The furthest of several statuses, for one that arrived before we knew its message. */
export function furthestStatus(statuses: readonly OutboundStatus[]): OutboundStatus | null {
  let best: OutboundStatus | null = null;
  for (const status of statuses) {
    if (best === null || canMoveStatus(best, status)) best = status;
  }
  return best;
}

export const STATUS_WORD: Record<MessageStatus, string> = {
  pending: "Sending",
  accepted: "Sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Not delivered",
  received: "Received",
};

// ── Opt-out ───────────────────────────────────────────────

export type OptChange = "opt_out" | "opt_in";

/** STOP / UNSUBSCRIBE opt out; START / YES opt back in. The whole message, any case, trailing punctuation ignored. */
export function optChange(text: string | null | undefined): OptChange | null {
  const word = (text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s.!]+$/u, "");
  if (word === "stop" || word === "unsubscribe") return "opt_out";
  if (word === "start" || word === "yes") return "opt_in";
  return null;
}

// ── Inbound previews ──────────────────────────────────────

const PLACEHOLDER: Record<string, string> = {
  image: "[Photo]",
  video: "[Video]",
  audio: "[Voice note]",
  voice: "[Voice note]",
  document: "[Document]",
  sticker: "[Sticker]",
  location: "[Location]",
  contacts: "[Contact card]",
  reaction: "[Reaction]",
};

/** Text for a message we don't download. The thread keeps the message, not the media. */
export function placeholderFor(type: string | null | undefined): string {
  return PLACEHOLDER[type ?? ""] ?? "[Message WhatsApp can't show here]";
}

export function previewOf(body: string | null | undefined, max = 120): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ── Templates ─────────────────────────────────────────────

export type GraphTemplateComponent = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string; example?: unknown }>;
};

export type GraphTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  parameter_format?: string;
  components?: GraphTemplateComponent[];
};

export type TemplateVariable = { part: "header" | "body"; key: string };

export type TemplateView = {
  name: string;
  language: string;
  category: string;
  header: string | null;
  body: string;
  footer: string | null;
  variables: TemplateVariable[];
  /** Null when it can be sent from the Hub, otherwise why not. */
  blockedReason: string | null;
};

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const HAS_VARIABLE = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/;

function variablesIn(text: string | undefined, part: "header" | "body"): TemplateVariable[] {
  const seen = new Set<string>();
  const out: TemplateVariable[] = [];
  for (const match of (text ?? "").matchAll(VARIABLE)) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ part, key });
  }
  // Positional variables are sent in number order.
  if (out.every((v) => /^\d+$/.test(v.key))) out.sort((a, b) => Number(a.key) - Number(b.key));
  return out;
}

/** An approved template as the composer shows it. Null for anything not approved or malformed. */
export function templateView(raw: GraphTemplate): TemplateView | null {
  if (raw.status !== "APPROVED" || !raw.name || !raw.language) return null;
  const components = raw.components ?? [];
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttons = components.find((c) => c.type === "BUTTONS");
  if (!body?.text) return null;

  let blockedReason: string | null = null;
  if (header && header.format && header.format !== "TEXT") {
    blockedReason = "It starts with a picture or file, which the Hub can't attach yet.";
  } else if (buttons?.buttons?.some((b) => HAS_VARIABLE.test(b.url ?? ""))) {
    blockedReason = "One of its buttons needs a value the Hub can't fill in yet.";
  }

  const headerText = header && (!header.format || header.format === "TEXT") ? (header.text ?? null) : null;
  return {
    name: raw.name,
    language: raw.language,
    category: (raw.category ?? "").toLowerCase(),
    header: headerText,
    body: body.text,
    footer: footer?.text ?? null,
    variables: [...variablesIn(headerText ?? undefined, "header"), ...variablesIn(body.text, "body")],
    blockedReason,
  };
}

/** The template's text with the pastor's values filled in, for the thread and the preview. */
export function fillTemplate(view: Pick<TemplateView, "header" | "body">, values: Record<string, string>, part?: "header" | "body"): string {
  const fill = (text: string, which: "header" | "body") =>
    text.replace(VARIABLE, (whole, key: string) => {
      const value = values[`${which}:${key}`];
      return value && value.trim() ? value.trim() : whole;
    });
  if (part === "header") return view.header ? fill(view.header, "header") : "";
  if (part === "body") return fill(view.body, "body");
  return [view.header ? fill(view.header, "header") : null, fill(view.body, "body")].filter(Boolean).join("\n\n");
}

export const MAX_VARIABLE_LENGTH = 200;

/** Every variable filled, single-line, not too long. Returns the first problem, or null. */
export function templateValuesProblem(view: TemplateView, values: Record<string, string>): string | null {
  for (const variable of view.variables) {
    const value = (values[`${variable.part}:${variable.key}`] ?? "").trim();
    if (!value) return "Fill in every blank before sending.";
    if (value.length > MAX_VARIABLE_LENGTH) return "One of the blanks is too long.";
    // WhatsApp refuses new lines, tabs and runs of spaces inside a variable.
    if (/[\n\t]| {5,}/.test(value)) return "Keep each blank to a single line.";
  }
  return null;
}

/** Graph `template.components` for the values. Named variables carry their name. */
export function templateComponents(view: TemplateView, values: Record<string, string>) {
  const components: Array<{ type: "header" | "body"; parameters: Array<{ type: "text"; text: string; parameter_name?: string }> }> = [];
  for (const part of ["header", "body"] as const) {
    const vars = view.variables.filter((v) => v.part === part);
    if (vars.length === 0) continue;
    components.push({
      type: part,
      parameters: vars.map((v) => {
        const text = (values[`${part}:${v.key}`] ?? "").trim();
        return /^\d+$/.test(v.key) ? { type: "text" as const, text } : { type: "text" as const, text, parameter_name: v.key };
      }),
    });
  }
  return components;
}

export const MAX_TEXT_LENGTH = 4096;
