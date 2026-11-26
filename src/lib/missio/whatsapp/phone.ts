// ────────────────────────────────────────────────────────────
// Missio WhatsApp — phone numbers
// ────────────────────────────────────────────────────────────
// Client-safe (no libphonenumber, so the people list stays light).
//
// contacts.phone is free text, usually typed the South African way
// (082 360 7000). WhatsApp's webhook sends wa_id as digits with the country
// code and no plus (27823607000). Threads are keyed on E.164 (+27823607000),
// and the Graph `to` field gets that same E.164 string.

/** Digits only, with the international prefix resolved. Null when it can't be a number. */
function internationalDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  // Words mean it isn't a plain number ("call me", "082… ext 4"): don't guess.
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  // Local South African form: 0 + nine digits.
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
    return digits.length === 9 ? `27${digits}` : null;
  }
  // Nine digits without the 0 (82 360 7000) are a South African mobile too.
  if (digits.length === 9 && /^[6-8]/.test(digits)) return `27${digits}`;
  return digits;
}

/**
 * E.164 for WhatsApp (`+27823607000`), or null when the number won't work.
 * South African numbers must be +27 and nine more digits, not starting with 0.
 * Other countries: 10–15 digits, no leading 0 after the plus.
 */
export function whatsAppE164(phone: string | null | undefined): string | null {
  const digits = internationalDigits(phone);
  if (!digits || digits.startsWith("0")) return null;
  if (digits.startsWith("27")) {
    // 27 0xx… is a mistyped local number with the country code in front.
    const rest = digits[2] === "0" ? digits.slice(3) : digits.slice(2);
    return rest.length === 9 && !rest.startsWith("0") ? `+27${rest}` : null;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/** A webhook wa_id (`27823607000`) as E.164. Same rules as a typed number. */
export function e164FromWaId(waId: string | null | undefined): string | null {
  if (!waId || !/^\d{8,15}$/.test(waId.trim())) return null;
  return whatsAppE164(`+${waId.trim()}`);
}

/** +27 82 360 7000 — how a number is shown when there's no name for it. */
export function formatE164(e164: string): string {
  const za = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (za) return `+27 ${za[1]} ${za[2]} ${za[3]}`;
  return e164;
}
