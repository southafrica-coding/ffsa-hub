// What the door shows after a scan. One pure function turns a server
// outcome, a failure, or an offline queue into a verdict, so every door
// (staff today, volunteer link in Phase 2) says the same thing.
//
// Status is carried by an icon AND words, never colour alone; the colours
// (green for a confirmed check-in, amber, red) are chosen in VerdictCard from
// the verdict's kind. Read at arm's length in bright sun.

import { ApiError } from "@/lib/api";

import type { ScanOutcome } from "./api";
import { formatClock } from "./dates";
import { strings } from "./strings";

export type VerdictKind =
  | "checked_in"
  | "already"
  | "wrong_event"
  | "invalid"
  | "void"
  | "not_a_ticket"
  | "needs_attention"
  | "queued";

/** The verdict's weight: ink = admit (filled), accent = already in, outline = heavy border, dashed = not confirmed. VerdictCard draws them. */
export type VerdictStyle = "ink" | "accent" | "outline" | "dashed";
export type VerdictIcon = "check" | "repeat" | "stop" | "alert" | "clock";
export type VerdictHaptic = "success" | "warning" | "error";

export type Verdict = {
  kind: VerdictKind;
  title: string;
  detail: string;
  style: VerdictStyle;
  icon: VerdictIcon;
  haptic: VerdictHaptic;
  /** Only a confirmed check-in can be undone. */
  undoTicketId: string | null;
  /** Let the guest in? Only true when the server has confirmed it. */
  admit: boolean;
};

const reject = (kind: VerdictKind, title: string, detail: string): Verdict => ({
  kind,
  title,
  detail,
  style: "outline",
  icon: "stop",
  haptic: "error",
  undoTicketId: null,
  admit: false,
});

export function verdictFromOutcome(outcome: ScanOutcome): Verdict {
  switch (outcome.result) {
    case "ok":
      return {
        kind: "checked_in",
        title: strings.result.checkedIn,
        detail: [outcome.buyerName, outcome.ticketTypeName].filter(Boolean).join(" · "),
        style: "ink",
        icon: "check",
        haptic: "success",
        undoTicketId: outcome.ticketId,
        admit: true,
      };
    case "already_checked_in": {
      const at = formatClock(outcome.checkedInAt);
      return {
        kind: "already",
        title: at ? strings.result.alreadyAt(at) : strings.result.already,
        detail: outcome.ticketTypeName,
        style: "accent",
        icon: "repeat",
        haptic: "warning",
        undoTicketId: null,
        admit: false,
      };
    }
    case "wrong_event":
      return reject("wrong_event", strings.result.wrongEvent, strings.result.wrongEventDetail);
    case "void":
      return reject("void", strings.result.void, strings.result.voidDetail);
    case "invalid":
      return reject("invalid", strings.result.invalid, strings.result.invalidDetail);
  }
}

export function verdictNotATicket(): Verdict {
  return reject("not_a_ticket", strings.result.invalid, strings.result.notQr);
}

export function verdictQueued(): Verdict {
  return {
    kind: "queued",
    title: strings.result.queued,
    detail: strings.result.queuedDetail,
    style: "dashed",
    icon: "clock",
    haptic: "warning",
    undoTicketId: null,
    admit: false,
  };
}

export function verdictUndone(): Verdict {
  return {
    kind: "needs_attention",
    title: strings.result.undone,
    detail: "",
    style: "outline",
    icon: "alert",
    haptic: "warning",
    undoTicketId: null,
    admit: false,
  };
}

export function verdictFromError(err: unknown, title: string = strings.result.needsAttention): Verdict {
  return {
    kind: "needs_attention",
    title,
    detail: err instanceof ApiError ? err.message : "Something went wrong. Try again, or find the guest by name.",
    style: "outline",
    icon: "alert",
    haptic: "error",
    undoTicketId: null,
    admit: false,
  };
}

/**
 * Failures where the scan should be saved and retried later rather than
 * shown as a problem: no connection, or a server that didn't answer.
 * (A server that answered with an error is shown, not queued: retrying
 * it silently would hide a real problem from the door.)
 */
export function isRetryableError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === "network" || err.kind === "timeout");
}
