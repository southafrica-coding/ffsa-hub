// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — building and checking menu messages
// ────────────────────────────────────────────────────────────
// Client-safe and pure.

import { MAX_TEXT_LENGTH } from "../rules";
import {
  ADD_ANOTHER,
  AVAILABILITY,
  CHOOSE,
  DONE,
  EXPERIENCE,
  FALLBACK,
  MAIN_MENU,
  SERVE_AVAILABILITY,
  SERVE_EXPERIENCE,
  SERVE_MORE_TEAMS,
  SERVE_OTHER_PROMPT,
  SERVE_OTHER_ROW,
  SERVE_TEAMS,
  SERVE_TEAMS_AGAIN,
  SERVE_TEAMS_BUTTON,
  serveAdded,
  serveThanks,
  WELCOME,
} from "./copy";
import type { BotMessage, ServeTeam, Team } from "./types";

// WhatsApp's own limits for interactive messages.
export const LIMITS = {
  body: 1024,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  id: 200,
} as const;

/** Null when WhatsApp will take it; otherwise what's wrong. */
export function interactiveProblem(message: BotMessage): string | null {
  if (!message.body.trim()) return "empty body";
  if (message.kind === "text") return message.body.length > MAX_TEXT_LENGTH ? "text too long" : null;
  if (message.body.length > LIMITS.body) return "body too long";
  const ids = new Set<string>();
  if (message.kind === "buttons") {
    if (message.buttons.length < 1 || message.buttons.length > LIMITS.buttons) return "1–3 buttons";
    for (const b of message.buttons) {
      if (!b.title.trim() || b.title.length > LIMITS.buttonTitle) return `button title "${b.title}"`;
      if (!b.id || b.id.length > LIMITS.id || ids.has(b.id)) return `button id "${b.id}"`;
      ids.add(b.id);
    }
    return null;
  }
  if (!message.button.trim() || message.button.length > LIMITS.listButton) return "list button";
  if (message.rows.length < 1 || message.rows.length > LIMITS.rows) return "1–10 rows";
  for (const r of message.rows) {
    if (!r.title.trim() || r.title.length > LIMITS.rowTitle) return `row title "${r.title}"`;
    if (r.description && r.description.length > LIMITS.rowDescription) return `row description "${r.description}"`;
    if (!r.id || r.id.length > LIMITS.id || ids.has(r.id)) return `row id "${r.id}"`;
    ids.add(r.id);
  }
  return null;
}

/** How a menu message reads in the pastor's thread: the words, then the choices. */
export function readableBody(message: BotMessage): string {
  if (message.kind === "text") return message.body;
  const choices = message.kind === "buttons" ? message.buttons.map((b) => b.title) : message.rows.map((r) => r.title);
  return `${message.body}\n\nChoices: ${choices.join(" · ")}`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ── Ids ───────────────────────────────────────────────────

export const HUMAN_ID = "human";
export const ID = {
  teamPrefix: "team:",
  teamOther: "team:other",
  teamsPagePrefix: "teams:page:",
  serveMore: "serve:more",
  serveDone: "serve:done",
  noteDone: "serve:note_done",
  availPrefix: "avail:",
  expPrefix: "exp:",
} as const;

const HUMAN_ROW = MAIN_MENU.find((row) => row.id === "human")!;

// ── Messages ──────────────────────────────────────────────

export function welcomeMessage(body: string = WELCOME): BotMessage {
  return { kind: "list", body, button: CHOOSE, rows: MAIN_MENU.map((r) => ({ id: r.id, title: r.title, description: r.description })) };
}

/** Teams not chosen yet, a page at a time: up to 8 teams + More + Other when the list is long. */
export function teamsMessage(teams: readonly Team[], chosen: readonly ServeTeam[], page: number, body: string): BotMessage {
  const taken = new Set(chosen.map((t) => t.id).filter(Boolean));
  const open = teams.filter((t) => !taken.has(t.id));
  const fitsOnOne = open.length + 1 <= LIMITS.rows;
  const perPage = fitsOnOne ? open.length : LIMITS.rows - 2;
  const pages = Math.max(1, Math.ceil(open.length / Math.max(perPage, 1)));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = fitsOnOne ? open : open.slice(current * perPage, current * perPage + perPage);
  const rows: Array<{ id: string; title: string; description?: string }> = slice.map((t) => ({
    id: `${ID.teamPrefix}${t.id}`,
    title: clip(t.name, LIMITS.rowTitle),
    ...(t.name.length > LIMITS.rowTitle ? { description: clip(t.name, LIMITS.rowDescription) } : {}),
  }));
  if (!fitsOnOne) rows.push({ id: `${ID.teamsPagePrefix}${(current + 1) % pages}`, ...SERVE_MORE_TEAMS });
  rows.push({ id: ID.teamOther, ...SERVE_OTHER_ROW });
  return { kind: "list", body, button: SERVE_TEAMS_BUTTON, rows };
}

export function firstTeamsMessage(teams: readonly Team[], chosen: readonly ServeTeam[] = [], page = 0): BotMessage {
  return teamsMessage(teams, chosen, page, chosen.length > 0 ? SERVE_TEAMS_AGAIN : SERVE_TEAMS);
}

export function otherTeamMessage(): BotMessage {
  return { kind: "text", body: SERVE_OTHER_PROMPT };
}

export function addedMessage(team: string): BotMessage {
  return {
    kind: "buttons",
    body: serveAdded(team),
    buttons: [
      { id: ID.serveMore, title: ADD_ANOTHER },
      { id: ID.serveDone, title: DONE },
    ],
  };
}

export function availabilityMessage(body: string = SERVE_AVAILABILITY): BotMessage {
  return { kind: "list", body, button: CHOOSE, rows: AVAILABILITY.map((a) => ({ id: `${ID.availPrefix}${a.id}`, title: a.title })) };
}

export function experienceMessage(body: string = SERVE_EXPERIENCE): BotMessage {
  return { kind: "buttons", body, buttons: EXPERIENCE.map((e) => ({ id: `${ID.expPrefix}${e.id}`, title: e.title })) };
}

export function thanksMessage(name: string | null, teams: readonly string[]): BotMessage {
  return { kind: "buttons", body: serveThanks(name, teams), buttons: [{ id: ID.noteDone, title: DONE }] };
}

/** The same step again, saying we didn't catch it. */
export function withFallback(message: BotMessage): BotMessage {
  if (message.kind === "text") return { kind: "text", body: `${FALLBACK}\n\n${message.body}` };
  return { ...message, body: FALLBACK + (message.body === WELCOME ? "" : `\n\n${message.body}`) };
}

/** After two misses: "Talk to a person" goes first. Buttons become a list so it fits. */
export function withHumanFirst(message: BotMessage): BotMessage {
  const human = { id: HUMAN_ID, title: HUMAN_ROW.title, description: HUMAN_ROW.description };
  if (message.kind === "text") return { kind: "buttons", body: message.body, buttons: [{ id: HUMAN_ID, title: HUMAN_ROW.title }] };
  const rows =
    message.kind === "list"
      ? message.rows.filter((r) => r.id !== HUMAN_ID)
      : message.buttons.filter((b) => b.id !== HUMAN_ID).map((b) => ({ id: b.id, title: b.title }));
  return { kind: "list", body: message.body, button: CHOOSE, rows: [human, ...rows].slice(0, LIMITS.rows) };
}
