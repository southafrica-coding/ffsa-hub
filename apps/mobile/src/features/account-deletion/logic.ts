// The delete-account screen as a pure state machine, so every state and
// transition is tested without rendering:
//
//   loading ──loaded(null)──▶ none ──openConfirm──▶ none/confirming ──submit──▶ none/requesting
//      │                       ▲                                                   │
//      │                       └────────────cancelled──────────┐          submitted│
//      └──loaded(request)────────────────▶ requested ◀─────────┼───────────────────┘
//                                           │ openCancel        │
//                                           ▼                   │
//                                 requested/confirmingCancel ──cancel──▶ requested/cancelling
//
// A failure never loses the person's place: it puts them back on the step
// they were on, with an error to show.

import { ApiError } from "@/lib/api";

export type DeletionRequest = {
  requestedAt: string;
  reason: string | null;
  /** false: the server emailed the team but couldn't save the request (202). */
  recorded: boolean;
};

export type ErrorKind =
  /** No connection or the server took too long. */
  | "offline"
  /** 503: the request couldn't be saved OR sent. Email the office. */
  | "unavailable"
  /** 409 on cancel: the Hub can't cancel it yet. Email the office. */
  | "cannotCancel"
  /** 403 (not deactivated): this account can't use it. */
  | "forbidden"
  /** 429: too many tries. */
  | "tooMany"
  | "generic";

export type DeletionState =
  | { kind: "loading" }
  | { kind: "loadError"; error: ErrorKind }
  | { kind: "none"; step: "idle" | "confirming" | "requesting"; error: ErrorKind | null }
  | {
      kind: "requested";
      request: DeletionRequest;
      step: "idle" | "confirmingCancel" | "cancelling";
      error: ErrorKind | null;
      /** True straight after sending (vs. found on a later visit). */
      justSent: boolean;
    };

export type DeletionEvent =
  | { type: "load" }
  | { type: "loaded"; request: DeletionRequest | null }
  | { type: "loadFailed"; error: ErrorKind }
  | { type: "openConfirm" }
  | { type: "closeConfirm" }
  | { type: "submit" }
  | { type: "submitted"; request: DeletionRequest }
  | { type: "submitFailed"; error: ErrorKind }
  | { type: "openCancel" }
  | { type: "closeCancel" }
  | { type: "cancel" }
  | { type: "cancelled" }
  | { type: "cancelFailed"; error: ErrorKind };

export const initialDeletionState: DeletionState = { kind: "loading" };

const none = (step: "idle" | "confirming" | "requesting" = "idle", error: ErrorKind | null = null): DeletionState => ({
  kind: "none",
  step,
  error,
});

export function deletionReducer(state: DeletionState, event: DeletionEvent): DeletionState {
  switch (event.type) {
    case "load":
      return { kind: "loading" };
    case "loaded":
      return event.request
        ? { kind: "requested", request: event.request, step: "idle", error: null, justSent: false }
        : none();
    case "loadFailed":
      return state.kind === "loading" ? { kind: "loadError", error: event.error } : state;
  }

  if (state.kind === "none") {
    switch (event.type) {
      case "openConfirm":
        return state.step === "idle" ? none("confirming", null) : state;
      case "closeConfirm":
        return state.step === "confirming" ? none("idle", state.error) : state;
      case "submit":
        // Only from the confirm sheet: never one tap from the screen.
        return state.step === "confirming" ? none("requesting") : state;
      case "submitted":
        return state.step === "requesting"
          ? { kind: "requested", request: event.request, step: "idle", error: null, justSent: true }
          : state;
      case "submitFailed":
        return state.step === "requesting" ? none("idle", event.error) : state;
      default:
        return state;
    }
  }

  if (state.kind === "requested") {
    switch (event.type) {
      case "openCancel":
        return state.step === "idle" ? { ...state, step: "confirmingCancel", error: null } : state;
      case "closeCancel":
        return state.step === "confirmingCancel" ? { ...state, step: "idle" } : state;
      case "cancel":
        return state.step === "confirmingCancel" ? { ...state, step: "cancelling" } : state;
      case "cancelled":
        return state.step === "cancelling" ? none() : state;
      case "cancelFailed":
        return state.step === "cancelling" ? { ...state, step: "idle", error: event.error } : state;
      default:
        return state;
    }
  }

  return state;
}

/** What went wrong, in the terms the screen explains. */
export function classifyError(err: unknown): ErrorKind {
  if (!(err instanceof ApiError)) return "generic";
  if (err.kind === "network" || err.kind === "timeout") return "offline";
  if (err.kind === "forbidden") return "forbidden";
  if (err.status === 503) return "unavailable";
  if (err.status === 409) return "cannotCancel";
  if (err.status === 429) return "tooMany";
  return "generic";
}

/** "3 November 2026", in South African time (where the team works). */
export function formatRequestedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Johannesburg",
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Busy states lock the buttons and the sheet. */
export function isBusy(state: DeletionState): boolean {
  return (
    (state.kind === "none" && state.step === "requesting") ||
    (state.kind === "requested" && state.step === "cancelling")
  );
}
