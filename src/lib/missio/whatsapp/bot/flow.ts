// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — what to answer (pure)
// ────────────────────────────────────────────────────────────
// Client-safe and pure: given where someone is and what they sent, say
// what to send back and where they are next. engine.ts does the guards
// (opt-out, pause, 24 hours, one answer per wamid) and the writes.
//
// Reading a reply: the tapped id first, then the exact words (any case,
// curly quotes and trailing punctuation ignored). At any step:
//   "talk to a person" / "person" / "pastor" / "human"  → a pastor takes it
//   "menu"                                               → the welcome list
// "menu" always starts over: this PR has no step that needs confirming
// before it is dropped, so an unfinished serving answer is just left.
//
// After a flow ends the session rests: nothing is sent for "thanks!" etc.
// until they type "menu" or a pastor-word, or the rest runs out
// (SESSION_IDLE_MS), when the next message gets the welcome again.

import { AVAILABILITY, EXPERIENCE, HANDOFF_DEFERRED, HANDOFF_HUMAN, MAIN_MENU, SERVE_CLOSE, type MenuId } from "./copy";
import {
  addedMessage,
  availabilityMessage,
  experienceMessage,
  firstTeamsMessage,
  HUMAN_ID,
  ID,
  otherTeamMessage,
  thanksMessage,
  welcomeMessage,
  withFallback,
  withHumanFirst,
} from "./messages";
import type { BotHandoffReason, BotMessage, ServeTeam, SessionData, SessionFlow, Team } from "./types";

/** A session untouched this long is over: the next message starts with the welcome. */
export const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
/** Misses at one step before "Talk to a person" goes first. */
export const MISSES_BEFORE_HUMAN_FIRST = 2;
export const MAX_NOTE = 1000;
export const MAX_OTHER_TEAM = 60;
export const MAX_TEAMS = 10;

export type FlowSession = { flow: SessionFlow; step: string; data: SessionData; failures: number } | null;

export type FlowInput = {
  session: FlowSession;
  inbound: { kind: "text" | "placeholder"; text: string | null; replyId: string | null };
  /** Live teams (or the fallback list), alphabetical. */
  teams: readonly Team[];
  /** Their first name for the thank-you, when we know it. */
  name: string | null;
};

export type FlowDecision = {
  replies: BotMessage[];
  /** Next session state; "close" ends it; null leaves it as it is. */
  session: { flow: SessionFlow; step: string; data: SessionData; failures: number } | { close: "handed_off" | "cancelled" } | null;
  handoff?: BotHandoffReason;
  /** Write a serving interest now (the thank-you says we have). */
  interest?: { teams: ServeTeam[]; availability: SessionData["availability"]; experience: SessionData["experience"] };
  /** Add this note to the interest written at the thank-you. */
  note?: string;
};

const HUMAN_WORDS = new Set(["talk to a person", "a person", "person", "pastor", "a pastor", "talk to a pastor", "human", "talk to someone"]);
const MENU_WORDS = new Set(["menu", "main menu", "the menu", "back to the menu"]);

/** Lowercase, straight quotes, single spaces, no trailing . ! ? */
export function normalise(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/u, "")
    .trim();
}

function said(input: FlowInput): string {
  return input.inbound.kind === "text" ? normalise(input.inbound.text) : "";
}

export function isHumanRequest(input: FlowInput): boolean {
  return input.inbound.replyId === HUMAN_ID || HUMAN_WORDS.has(said(input));
}

export function isMenuRequest(input: FlowInput): boolean {
  return MENU_WORDS.has(said(input));
}

const DEFERRED: ReadonlySet<MenuId> = new Set(["new", "house", "care", "feedback"]);

/** A main-menu choice from a tap or the words: the row's id, its title, or the id itself ("serve"). */
export function mainChoice(input: FlowInput): MenuId | null {
  const id = input.inbound.replyId;
  if (id && MAIN_MENU.some((row) => row.id === id)) return id as MenuId;
  const words = said(input);
  if (!words) return null;
  const row = MAIN_MENU.find((r) => normalise(r.title) === words || r.id === words);
  return row?.id ?? null;
}

export function welcome(): FlowDecision {
  return { replies: [welcomeMessage()], session: { flow: "menu", step: "main", data: {}, failures: 0 } };
}

function handoff(reason: "human" | "deferred"): FlowDecision {
  return { replies: [{ kind: "text", body: reason === "human" ? HANDOFF_HUMAN : HANDOFF_DEFERRED }], session: { close: "handed_off" }, handoff: reason };
}

function startServe(teams: readonly Team[]): FlowDecision {
  return { replies: [firstTeamsMessage(teams)], session: { flow: "serve", step: "teams", data: { teams: [], page: 0 }, failures: 0 } };
}

function choose(choice: MenuId, teams: readonly Team[]): FlowDecision {
  if (choice === "human") return handoff("human");
  if (DEFERRED.has(choice)) return handoff("deferred");
  return startServe(teams);
}

/** The prompt for the step they're on, to send again after a miss. */
function promptFor(session: NonNullable<FlowSession>, teams: readonly Team[], name: string | null): BotMessage {
  const chosen = session.data.teams ?? [];
  switch (`${session.flow}:${session.step}`) {
    case "serve:teams":
      return firstTeamsMessage(teams, chosen, session.data.page ?? 0);
    case "serve:other":
      return otherTeamMessage();
    case "serve:added":
      return addedMessage(chosen[chosen.length - 1]?.name ?? "that");
    case "serve:availability":
      return availabilityMessage();
    case "serve:experience":
      return experienceMessage();
    case "serve:note":
      return thanksMessage(name, chosen.map((t) => t.name));
    default:
      return welcomeMessage();
  }
}

function miss(session: NonNullable<FlowSession>, teams: readonly Team[], name: string | null): FlowDecision {
  const failures = session.failures + 1;
  let message = withFallback(promptFor(session, teams, name));
  if (failures >= MISSES_BEFORE_HUMAN_FIRST) message = withHumanFirst(message);
  return { replies: [message], session: { ...session, failures } };
}

function teamFromInput(input: FlowInput): { team: Team } | { other: true } | { page: number } | null {
  const id = input.inbound.replyId;
  if (id === ID.teamOther) return { other: true };
  if (id?.startsWith(ID.teamsPagePrefix)) {
    const page = Number(id.slice(ID.teamsPagePrefix.length));
    return Number.isInteger(page) && page >= 0 ? { page } : null;
  }
  if (id?.startsWith(ID.teamPrefix)) {
    const team = input.teams.find((t) => t.id === id.slice(ID.teamPrefix.length));
    if (team) return { team };
  }
  const words = said(input);
  if (!words) return null;
  if (words === "other") return { other: true };
  const team = input.teams.find((t) => normalise(t.name) === words);
  return team ? { team } : null;
}

function addTeam(data: SessionData, team: ServeTeam): FlowDecision {
  const teams = [...(data.teams ?? [])];
  const dupe = teams.some((t) => (team.id ? t.id === team.id : normalise(t.name) === normalise(team.name)));
  if (!dupe && teams.length < MAX_TEAMS) teams.push(team);
  return { replies: [addedMessage(team.name)], session: { flow: "serve", step: "added", data: { ...data, teams, page: 0 }, failures: 0 } };
}

function toAvailability(data: SessionData): FlowDecision {
  return { replies: [availabilityMessage()], session: { flow: "serve", step: "availability", data, failures: 0 } };
}

function serveStep(session: NonNullable<FlowSession>, input: FlowInput): FlowDecision {
  const data = session.data;
  const chosen = data.teams ?? [];
  const words = said(input);
  const id = input.inbound.replyId;

  switch (session.step) {
    case "teams":
    case "added": {
      if (chosen.length > 0 && (id === ID.serveDone || words === "done")) return toAvailability(data);
      if (id === ID.serveMore || words === "add another") {
        return { replies: [firstTeamsMessage(input.teams, chosen, 0)], session: { flow: "serve", step: "teams", data: { ...data, page: 0 }, failures: 0 } };
      }
      const pick = teamFromInput(input);
      if (pick && "team" in pick) return addTeam(data, { id: pick.team.id, name: pick.team.name });
      if (pick && "other" in pick) return { replies: [otherTeamMessage()], session: { flow: "serve", step: "other", data, failures: 0 } };
      if (pick && "page" in pick) {
        return {
          replies: [firstTeamsMessage(input.teams, chosen, pick.page)],
          session: { flow: "serve", step: "teams", data: { ...data, page: pick.page }, failures: 0 },
        };
      }
      return miss(session, input.teams, input.name);
    }
    case "other": {
      const typed = input.inbound.kind === "text" ? (input.inbound.text ?? "").replace(/\s+/g, " ").trim() : "";
      // A tap on an old list row still counts as picking that team.
      const pick = teamFromInput(input);
      if (pick && "team" in pick) return addTeam(data, { id: pick.team.id, name: pick.team.name });
      if (!typed || id) return miss(session, input.teams, input.name);
      return addTeam(data, { id: null, name: typed.slice(0, MAX_OTHER_TEAM) });
    }
    case "availability": {
      const found = AVAILABILITY.find((a) => id === `${ID.availPrefix}${a.id}` || normalise(a.title) === words);
      if (!found) return miss(session, input.teams, input.name);
      return { replies: [experienceMessage()], session: { flow: "serve", step: "experience", data: { ...data, availability: found.id }, failures: 0 } };
    }
    case "experience": {
      const found = EXPERIENCE.find((e) => id === `${ID.expPrefix}${e.id}` || normalise(e.title) === words);
      if (!found) return miss(session, input.teams, input.name);
      const next = { ...data, experience: found.id };
      return {
        replies: [thanksMessage(input.name, chosen.map((t) => t.name))],
        session: { flow: "serve", step: "note", data: next, failures: 0 },
        interest: { teams: chosen, availability: next.availability, experience: found.id },
      };
    }
    case "note": {
      const rest = { flow: "rest" as const, step: "done", data: { interestId: data.interestId }, failures: 0 };
      if (id === ID.noteDone || words === "done") return { replies: [{ kind: "text", body: SERVE_CLOSE }], session: rest };
      const typed = input.inbound.kind === "text" && !id ? (input.inbound.text ?? "").trim() : "";
      if (!typed) return miss(session, input.teams, input.name);
      return { replies: [{ kind: "text", body: SERVE_CLOSE }], session: rest, note: typed.slice(0, MAX_NOTE) };
    }
    default:
      return welcome();
  }
}

/**
 * What to answer. Assumes the guards passed (not opted out, bot on, inside
 * the 24 hours) and that this message hasn't been answered before.
 */
export function decide(input: FlowInput): FlowDecision {
  if (isHumanRequest(input)) return handoff("human");
  if (isMenuRequest(input)) return welcome();

  const session = input.session;
  if (!session) {
    // A first message: a recognised choice goes straight there; anything else gets the welcome.
    const choice = mainChoice(input);
    return choice ? choose(choice, input.teams) : welcome();
  }

  if (session.flow === "rest") {
    // A tap on an old menu still works; anything else waits for a pastor or "menu".
    const choice = input.inbound.replyId ? mainChoice(input) : null;
    return choice ? choose(choice, input.teams) : { replies: [], session: null };
  }

  if (session.flow === "menu") {
    const choice = mainChoice(input);
    return choice ? choose(choice, input.teams) : miss(session, input.teams, input.name);
  }

  // Mid-serve, a tap on the main menu (an older message) changes course.
  if (input.inbound.replyId && MAIN_MENU.some((r) => r.id === input.inbound.replyId)) {
    return choose(input.inbound.replyId as MenuId, input.teams);
  }
  return serveStep(session, input);
}

/** "Bot is asking which team" — or null when the bot isn't mid-flow. */
export function sessionActive(session: { flow: SessionFlow; closed_at?: string | null } | null): boolean {
  return Boolean(session && !session.closed_at && session.flow !== "rest");
}
