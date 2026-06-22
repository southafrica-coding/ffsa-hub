/**
 * Twilio WhatsApp client.
 *
 * Sends business-initiated WhatsApp messages. Outside the 24-hour
 * customer-service window WhatsApp requires a pre-approved Content
 * template, so the production path passes `contentSid` + `contentVariables`.
 * A free-form `body` path is supported for the Twilio sandbox / inside-window
 * testing (the sandbox accepts free-form Body), so organisers can verify the
 * channel before a template is approved.
 *
 * Configuration is entirely env-driven and the client degrades gracefully:
 * if Twilio isn't configured it returns `{ ok:false, skipped:true }` rather
 * than throwing — mirroring the skip contract used by the Slack daily-ticket
 * report cron so an unconfigured channel never breaks the dispatcher.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID          – Twilio account SID (AC…)
 *   TWILIO_AUTH_TOKEN           – Twilio auth token
 *   TWILIO_WHATSAPP_FROM        – sender, e.g. "whatsapp:+14155238886"
 *   TWILIO_WA_REPORT_CONTENT_SID – approved Content template SID (HX…) for digests
 */

export type WhatsAppSendResult =
  | { ok: true; sid: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

export type WhatsAppSendArgs = {
  /** Destination in E.164 (no "whatsapp:" prefix — added here). */
  to: string;
  /** Approved Content template SID. When present, a template message is sent. */
  contentSid?: string | null;
  /** Variables for the Content template. */
  contentVariables?: Record<string, string>;
  /** Free-form text used only when no contentSid is given (sandbox/in-window). */
  body?: string;
};

/** True when the core Twilio credentials are present. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  );
}

function withWhatsAppPrefix(addr: string): string {
  return addr.startsWith("whatsapp:") ? addr : `whatsapp:${addr}`;
}

export async function sendWhatsApp(
  args: WhatsAppSendArgs
): Promise<WhatsAppSendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      skipped: true,
      reason:
        "Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)",
    };
  }
  if (!args.to) {
    return { ok: false, skipped: true, reason: "No destination number" };
  }
  if (!args.contentSid && !args.body) {
    return {
      ok: false,
      skipped: true,
      reason:
        "No approved template (TWILIO_WA_REPORT_CONTENT_SID) and no fallback body",
    };
  }

  try {
    // Lazy import so a missing dep or cold start never breaks email-only sends.
    const twilioModule = await import("twilio");
    const createTwilioClient = twilioModule.default;
    const client = createTwilioClient(accountSid, authToken);

    const base = {
      from: withWhatsAppPrefix(from),
      to: withWhatsAppPrefix(args.to),
    };
    const options = args.contentSid
      ? {
          ...base,
          contentSid: args.contentSid,
          ...(args.contentVariables
            ? { contentVariables: JSON.stringify(args.contentVariables) }
            : {}),
        }
      : { ...base, body: args.body ?? "" };

    const message = await client.messages.create(options);
    return { ok: true, sid: message.sid };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
