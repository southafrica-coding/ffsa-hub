import type { FormAccessMode } from "./schema";

// ============================================================
// Who may open and send a form — forms.access_mode (migration 390)
// ============================================================

/** access_mode as stored. Missing (before migration 390) means public. */
export function accessModeOf(raw: unknown): FormAccessMode {
  return raw === "logged_in" || raw === "token" ? raw : "public";
}

export type FormAccessDecision = "open" | "sign_in" | "closed";

/**
 * The runtime page and the submit route both ask this.
 *   public    → open to anyone with the link.
 *   logged_in → open once signed in to the Hub.
 *   token     → closed at /f/<slug>: it opens only from a per-subject
 *               link, so it fails closed rather than falling back to
 *               public. The one exception is the Missio weekly feedback
 *               form, which the page and submit route hand to its own
 *               public flow with a house church picker before asking
 *               this (isMissioPublicFeedbackForm).
 */
export function formAccessDecision(mode: FormAccessMode, signedIn: boolean): FormAccessDecision {
  if (mode === "public") return "open";
  if (mode === "logged_in") return signedIn ? "open" : "sign_in";
  return "closed";
}
