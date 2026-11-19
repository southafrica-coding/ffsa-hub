import type { ConnectDraft, ConnectFieldErrors, ConnectSubmitBody, VisitType } from "./types";

const VISIT: ReadonlySet<string> = new Set(["first_time", "been_a_while", "regular"]);

export function phoneLooksOk(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(value.trim());
}

/** A local number (082…) with the wrong digit count, so the error can say how many. */
function localDigits(value: string): number | null {
  const trimmed = value.trim();
  if (!/^0[\d\s()-]*$/.test(trimmed)) return null;
  const count = trimmed.replace(/\D/g, "").length;
  return count === 10 ? null : count;
}

export function validateConnect(draft: ConnectDraft): ConnectFieldErrors {
  const errors: ConnectFieldErrors = {};
  const name = draft.name.trim();
  if (name.length < 2) errors.name = "Enter your name.";
  else if (name.length > 80) errors.name = "Use 80 characters or fewer.";

  const phone = draft.phone.trim();
  if (!phone) errors.phone = "Enter a phone number.";
  else if (localDigits(phone) != null) errors.phone = `That’s ${localDigits(phone)} digits. A South African cellphone number has 10.`;
  else if (!phoneLooksOk(phone)) errors.phone = "That phone number doesn’t look right.";

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
  const notes = draft.notes.trim();
  if (notes) body.notes = notes;
  const prayer = draft.prayerRequest.trim();
  if (draft.wantsPrayer && prayer) body.prayerRequest = prayer;
  return body;
}
