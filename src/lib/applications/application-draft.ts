// ─── Public application draft (this device only) ──────────────────────────
//
// The public apply form is long (FFX: 40+ fields) and applicants fill it on
// phones. A phone reloads the page on pull-to-refresh, and mobile browsers
// throw away a background tab when the applicant switches to WhatsApp or
// email to look something up. Either way every answer was lost — "the form
// keeps clearing itself". The draft below survives both, on this device
// only, and is removed once the application goes in.
//
// Storage can be missing or throw (private mode, blocked site data), so
// every access is wrapped: the form must keep working without it.

export type ApplicationDraft = {
  v: 1;
  savedAt: number;
  answers: Record<string, unknown>;
  refNames: Record<string, string>;
  refEmails: Record<string, string>;
  firstName: string;
  lastName: string;
  email: string;
  nationality: string;
  homeCountry: string;
  trackMode: "whole_program" | "segments";
  selectedSegmentIds: string[];
};

/** Drafts older than this are ignored and removed. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function applicationDraftKey(programId: string): string {
  return `ffsa-apply-draft:${programId}`;
}

export function readApplicationDraft(key: string): ApplicationDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as ApplicationDraft;
    if (draft?.v !== 1 || typeof draft.savedAt !== "number") return null;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeApplicationDraft(key: string, draft: ApplicationDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked — the form still works, it just won't survive a reload.
  }
}

export function clearApplicationDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** True when the draft holds anything the applicant actually typed or picked. */
export function draftHasContent(draft: ApplicationDraft): boolean {
  const filled = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v !== "" && v !== null && v !== undefined && v !== false;
  return (
    Object.values(draft.answers).some(filled) ||
    Object.values(draft.refNames).some(filled) ||
    Object.values(draft.refEmails).some(filled) ||
    [draft.firstName, draft.lastName, draft.email, draft.nationality, draft.homeCountry].some(filled)
  );
}
