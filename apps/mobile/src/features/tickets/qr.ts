// What a ticket QR (or a typed code) may contain.
//
// The web issues codes as 8 random bytes in base64url (~11 characters, see
// the website's src/lib/ticketing/fulfillment.ts) and the QR encodes the bare
// code. The public QR route accepts 4–64 characters, so we accept the same
// range of base64url characters and nothing else. A QR that holds a URL is
// accepted only if it carries the code in a recognisable place (a `code`
// query parameter or a /tickets/<code> path), so a scanned poster or Wi-Fi
// code never reaches the server.

export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 64;

const CODE_RE = /^[A-Za-z0-9_-]+$/;

export type ParsedCode = { ok: true; code: string } | { ok: false; reason: "empty" | "not_a_ticket" };

export function isTicketCode(value: string): boolean {
  return value.length >= MIN_CODE_LENGTH && value.length <= MAX_CODE_LENGTH && CODE_RE.test(value);
}

function codeFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const param = url.searchParams.get("code");
  if (param) return param.trim();
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("tickets");
  return i >= 0 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : null;
}

export function parseTicketCode(raw: string | null | undefined): ParsedCode {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "empty" };
  if (isTicketCode(value)) return { ok: true, code: value };
  if (/^https?:\/\//i.test(value)) {
    const fromUrl = codeFromUrl(value);
    if (fromUrl && isTicketCode(fromUrl)) return { ok: true, code: fromUrl };
  }
  return { ok: false, reason: "not_a_ticket" };
}
