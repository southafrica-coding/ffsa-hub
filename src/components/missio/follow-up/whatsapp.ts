/** South African mobiles are dialled locally as 082… and on WhatsApp as 2782…. */
export function whatsAppDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsAppHref(phone: string | null | undefined): string | null {
  const digits = whatsAppDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

export function telHref(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim() ?? "";
  if (!trimmed) return null;
  const dial = trimmed.replace(/[^\d+]/g, "");
  return dial ? `tel:${dial}` : null;
}
