import type { ConnectDraft, ConnectFieldErrors, ConnectSubmitBody, VisitType } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VISIT: ReadonlySet<string> = new Set(["first_time", "been_a_while", "regular"]);

export function phoneLooksOk(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(value.trim());
}

export function validateConnect(draft: ConnectDraft): ConnectFieldErrors {
  const errors: ConnectFieldErrors = {};
  const name = draft.name.trim();
  if (name.length < 2) errors.name = "Enter your name.";
  else if (name.length > 80) errors.name = "Use 80 characters or fewer.";

  const phone = draft.phone.trim();
  if (!phone) errors.phone = "Enter a phone number.";
  else if (!phoneLooksOk(phone)) errors.phone = "That phone number doesn’t look right.";

  const email = draft.email.trim();
  if (email && !EMAIL_RE.test(email)) errors.email = "That email address doesn’t look right.";

  if (!VISIT.has(draft.visitType)) errors.visitType = "Choose one.";

  if (draft.notes.trim().length > 1000) errors.notes = "Use 1,000 characters or fewer.";
  if (draft.wantsPrayer && draft.prayerRequest.trim().length > 1000) {
    errors.prayerRequest = "Use 1,000 characters or fewer.";
  }
  return errors;
}

export function toConnectBody(draft: ConnectDraft): ConnectSubmitBody {
  const body: ConnectSubmitBody = {
    name: draft.name.trim(),
    phone: draft.phone.trim(),
    visitType: draft.visitType as VisitType,
    wantsHouseChurch: draft.wantsHouseChurch,
    wantsPrayer: draft.wantsPrayer,
    website: "",
  };
  const email = draft.email.trim();
  if (email) body.email = email;
  const notes = draft.notes.trim();
  if (notes) body.notes = notes;
  const prayer = draft.prayerRequest.trim();
  if (draft.wantsPrayer && prayer) body.prayerRequest = prayer;
  return body;
}
