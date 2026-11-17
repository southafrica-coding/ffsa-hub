/** Mask an address so a pastor can confirm a hit without receiving the FFSA directory. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at < 1) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const dot = domain.indexOf(".");
  if (dot < 1) return null;
  const host = domain.slice(0, dot);
  const rest = domain.slice(dot);
  return `${local[0]}***@${host[0]}***${rest}`;
}

/** Last four digits only, in the form `*** *** 4567`. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `*** *** ${digits.slice(-4)}`;
}
