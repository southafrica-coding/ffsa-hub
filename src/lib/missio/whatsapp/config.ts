// ────────────────────────────────────────────────────────────
// Missio WhatsApp — environment
// ────────────────────────────────────────────────────────────
// Server only. Every value comes from the environment; nothing has a
// default in the repo. Missing values switch the matching part off (503),
// never on. The token and secrets are only ever passed to fetch / HMAC —
// never logged, returned or sent to the browser.

export const GRAPH_VERSION = "v23.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type SendConfig = { accessToken: string; phoneNumberId: string; wabaId: string };

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/** Sending and reading templates: token, phone number id and WABA id. */
export function sendConfig(env: Env = process.env): SendConfig | null {
  const accessToken = read(env, "MISSIO_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = read(env, "MISSIO_WHATSAPP_PHONE_NUMBER_ID");
  const wabaId = read(env, "MISSIO_WHATSAPP_WABA_ID");
  if (!accessToken || !phoneNumberId || !wabaId) return null;
  return { accessToken, phoneNumberId, wabaId };
}

/** The app secret that signs webhook POSTs. */
export function webhookSecret(env: Env = process.env): string | null {
  return read(env, "MISSIO_WHATSAPP_APP_SECRET");
}

/** The shared token for Meta's GET handshake. */
export function webhookVerifyToken(env: Env = process.env): string | null {
  return read(env, "MISSIO_WHATSAPP_VERIFY_TOKEN");
}

/** Only messages to this number are stored; anything else on the app is ignored. */
export function webhookPhoneNumberId(env: Env = process.env): string | null {
  return read(env, "MISSIO_WHATSAPP_PHONE_NUMBER_ID");
}
