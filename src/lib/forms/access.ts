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
 *   token     → closed. Per-subject links (the 20 house links) are a
 *               later step; until they exist nobody can open one, so it
 *               fails closed rather than falling back to public.
 */
export function formAccessDecision(mode: FormAccessMode, signedIn: boolean): FormAccessDecision {
  if (mode === "public") return "open";
  if (mode === "logged_in") return signedIn ? "open" : "sign_in";
  return "closed";
}
