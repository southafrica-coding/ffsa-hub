// Hub feedback — the vocabulary shared by the form, the board and the
// submitter's own list. Pure data so client components can import it.
// The SQL CHECKs in migration 261 are the source of truth; keep in step.

import type { Tone } from "@/components/ffsa";

export const FEEDBACK_KINDS = ["problem", "idea", "vision"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const KIND_META: Record<FeedbackKind, { label: string; hint: string; placeholder: string }> = {
  problem: {
    label: "Problem",
    hint: "Something is broken or confusing",
    placeholder: "What were you trying to do, and what happened instead?",
  },
  idea: {
    label: "Idea",
    hint: "A feature or an improvement",
    placeholder: "What would you like the Hub to do, and what would it save you?",
  },
  vision: {
    label: "Vision",
    hint: "A bigger 'one day the Hub should…'",
    placeholder: "Where should the Hub be heading, and why does it matter?",
  },
};

export const SEVERITIES = ["blocking", "annoying", "minor"] as const;
export type FeedbackSeverity = (typeof SEVERITIES)[number];

export const SEVERITY_META: Record<FeedbackSeverity, { label: string; hint: string; tone: Tone }> = {
  blocking: { label: "Blocking", hint: "I can't get my work done", tone: "bad" },
  annoying: { label: "Annoying", hint: "There's a workaround, but it hurts", tone: "warn" },
  minor: { label: "Minor", hint: "Small, but worth fixing", tone: "quiet" },
};

export const FEEDBACK_STATUSES = [
  "new",
  "needs_info",
  "accepted",
  "planned",
  "in_progress",
  "shipped",
  "declined",
  "duplicate",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const STATUS_META: Record<FeedbackStatus, { label: string; tone: Tone; forSubmitter: string }> = {
  new: { label: "New", tone: "warn", forSubmitter: "Sent — waiting to be read" },
  needs_info: { label: "Needs info", tone: "warn", forSubmitter: "We have a question for you" },
  accepted: { label: "Accepted", tone: "good", forSubmitter: "Accepted — it's on the list" },
  planned: { label: "Planned", tone: "good", forSubmitter: "Planned" },
  in_progress: { label: "In progress", tone: "good", forSubmitter: "Being built" },
  shipped: { label: "Shipped", tone: "good", forSubmitter: "Shipped" },
  declined: { label: "Declined", tone: "quiet", forSubmitter: "Not going ahead for now" },
  duplicate: { label: "Duplicate", tone: "quiet", forSubmitter: "Merged with a matching item" },
};

/** Board tabs. Each tab is a set of statuses. */
export const BOARD_TABS: { key: string; label: string; statuses: FeedbackStatus[] }[] = [
  { key: "inbox", label: "Inbox", statuses: ["new"] },
  { key: "needs_info", label: "Needs info", statuses: ["needs_info"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "planned", label: "Planned", statuses: ["planned"] },
  { key: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped"] },
  { key: "closed", label: "Closed", statuses: ["declined", "duplicate"] },
];

export const TITLE_MAX = 200;
export const DETAILS_MAX = 5000;

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return typeof v === "string" && (FEEDBACK_KINDS as readonly string[]).includes(v);
}
export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(v);
}
export function isFeedbackSeverity(v: unknown): v is FeedbackSeverity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/** "21 Oct" / "21 Oct, 14:05" in SAST, so server and browser render the same. */
export function fmtFeedbackDate(iso: string, withTime = false): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}
