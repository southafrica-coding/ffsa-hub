// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — shared types
// ────────────────────────────────────────────────────────────
// Client-safe. No token, secret or phone number of staff appears here.

import type { OptChange } from "../rules";
import type { BotHandoffReason, BotMode, ThreadRow } from "../store";
import type { Availability, Experience } from "./copy";

/** One stored inbound message the menu should answer. Built by the webhook after the store. */
export type BotJob = {
  orgId: string;
  threadId: string;
  messageId: string;
  wamid: string;
  /** WhatsApp's timestamp for the message. */
  at: string;
  kind: "text" | "placeholder";
  /** What they typed (or the title they tapped). Null for media. */
  text: string | null;
  /** The id of the button or list row they tapped. */
  replyId: string | null;
  optChange: OptChange | null;
  /** The thread was opted out before this message (so a START / YES just lifted it). */
  wasOptedOut: boolean;
};

/** What the menu sends, before the phone number is added. */
export type BotMessage =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: Array<{ id: string; title: string }> }
  | { kind: "list"; body: string; button: string; rows: Array<{ id: string; title: string; description?: string }> };

export type SessionFlow = "menu" | "serve" | "rest";
export type SessionCloseReason = "done" | "cancelled" | "handed_off" | "expired" | "opted_out" | "paused";

export type ServeTeam = { id: string | null; name: string };

export type SessionData = {
  teams?: ServeTeam[];
  /** Which page of a long team list is showing. */
  page?: number;
  availability?: Availability;
  experience?: Experience;
  /** The serving interest written at the thank-you, so a note lands on it. */
  interestId?: string;
};

export type SessionRow = {
  id: string;
  org_id: string;
  thread_id: string;
  flow: SessionFlow;
  step: string;
  data: SessionData;
  failures: number;
  last_inbound_wamid: string | null;
  closed_at: string | null;
  closed_reason: SessionCloseReason | null;
  created_at: string;
  updated_at: string;
};

export type OutboxStatus = "pending" | "sent" | "failed";

export type ServingInterestInput = {
  orgId: string;
  threadId: string;
  contactId: string | null;
  teams: ServeTeam[];
  availability: Availability | null;
  experience: Experience | null;
};

export type ServingInterestRow = ServingInterestInput & {
  id: string;
  note: string | null;
  status: "new" | "contacted" | "placed" | "closed";
  createdAt: string;
};

export type Team = { id: string; name: string };

/** The bot's own writes (service role). Implemented by supabase-store.ts and testing/memory-store.ts. */
export interface BotStore {
  /**
   * Claim this inbound message for the menu. False when another delivery
   * (or another server) already claimed it: answer nothing.
   */
  claimTurn(input: { orgId: string; threadId: string; wamid: string; at: string }): Promise<boolean>;
  finishTurn(wamid: string, status: "sent" | "failed", error?: { code: number | null; title: string }): Promise<void>;
  /** A newer message on this thread has already been answered (so this one is stale). */
  newerTurnExists(threadId: string, at: string, wamid: string): Promise<boolean>;
  getThread(threadId: string): Promise<ThreadRow | null>;
  openSession(threadId: string): Promise<SessionRow | null>;
  /** Update the open session, or open one. */
  saveSession(input: {
    orgId: string;
    threadId: string;
    flow: SessionFlow;
    step: string;
    data: SessionData;
    failures: number;
    wamid: string | null;
  }): Promise<void>;
  closeSession(threadId: string, reason: SessionCloseReason): Promise<void>;
  setBotMode(threadId: string, input: { mode: BotMode; reason: BotHandoffReason | null; by: string | null; at: string }): Promise<void>;
  /** Null when this (wamid, seq) reply was already queued: don't send it again. */
  enqueueReply(input: { orgId: string; threadId: string; wamid: string; at: string; seq: number; payload: BotMessage }): Promise<{ id: string } | null>;
  finishReply(id: string, input: { status: "sent" | "failed"; messageId: string | null; error?: { code: number | null; title: string } }): Promise<void>;
  insertServingInterest(input: ServingInterestInput): Promise<{ id: string }>;
  setServingInterestNote(id: string, note: string): Promise<void>;
  /** missio_teams for the org, alphabetical. Throws on a read error (the caller falls back). */
  liveTeams(orgId: string): Promise<Team[]>;
  /** The linked person's first (or preferred) name, for "Thank you, Kea". */
  contactFirstName(contactId: string): Promise<string | null>;
}

export type { BotHandoffReason, BotMode };
