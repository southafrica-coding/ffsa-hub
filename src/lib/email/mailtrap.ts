// Mailtrap "Email Sending" API wrapper — used for marketing campaigns.
// Transactional system email continues to go through Resend; Mailtrap is
// the marketing/broadcast channel per the CRM spec.

const MAILTRAP_BULK_URL = "https://bulk.api.mailtrap.io/api/send";

export type MailtrapAttachment = {
  filename: string;
  /** Already-encoded base64 string of the file bytes. */
  contentBase64: string;
  /** MIME type. ICS invites use 'text/calendar; method=REQUEST'. */
  type: string;
  /** 'attachment' (default) or 'inline'. */
  disposition?: "attachment" | "inline";
};

export type MailtrapSendInput = {
  fromEmail: string;
  fromName: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  /** Plain-text alternative — pair with html for proper multipart/alternative. */
  text?: string;
  category?: string;
  /**
   * Custom headers. Standard set for marketing email:
   *   List-Unsubscribe        — RFC 2369 unsubscribe URL
   *   List-Unsubscribe-Post   — RFC 8058 one-click unsubscribe signal
   *   List-ID                 — RFC 2919 list identifier
   *   Precedence: bulk        — flags as bulk mail
   */
  headers?: Record<string, string>;
  attachments?: MailtrapAttachment[];
};

export type MailtrapSendResult = {
  messageId: string | null;
  error: string | null;
  /**
   * True when Mailtrap rejected the send because the account's hourly sending
   * quota is exhausted (HTTP 429 or an `hourly_rate_exceeded` body). Callers
   * must treat this as "try again later" — NOT a permanent failure — and stop
   * the current run without recording the recipient, so a later run retries.
   */
  rateLimited?: boolean;
};

/** Does a Mailtrap error response indicate the hourly quota was hit? */
function isRateLimit(status: number, body: string): boolean {
  return status === 429 || /hourly_rate_exceeded|rate.?limit/i.test(body);
}

/** Send a single email through Mailtrap. Never throws — returns an error string. */
export async function sendViaMailtrap(
  input: MailtrapSendInput
): Promise<MailtrapSendResult> {
  const token = process.env.MAILTRAP_API_TOKEN;
  if (!token) {
    return { messageId: null, error: "MAILTRAP_API_TOKEN is not configured" };
  }

  try {
    const payload: Record<string, unknown> = {
      from: { email: input.fromEmail, name: input.fromName },
      to: [{ email: input.to }],
      subject: input.subject,
      html: input.html,
    };
    if (input.replyTo) payload.reply_to = { email: input.replyTo };
    if (input.text) payload.text = input.text;
    if (input.category) payload.category = input.category;
    if (input.headers && Object.keys(input.headers).length > 0) {
      payload.headers = input.headers;
    }
    if (input.attachments && input.attachments.length > 0) {
      payload.attachments = input.attachments.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
        type: a.type,
        disposition: a.disposition ?? "attachment",
      }));
    }

    const res = await fetch(MAILTRAP_BULK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Token": token,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        messageId: null,
        error: `Mailtrap ${res.status}: ${body.slice(0, 200)}`,
        rateLimited: isRateLimit(res.status, body),
      };
    }

    const data = (await res.json().catch(() => ({}))) as {
      message_ids?: string[];
      success?: boolean;
    };
    return { messageId: data.message_ids?.[0] ?? null, error: null };
  } catch (e) {
    return {
      messageId: null,
      error: e instanceof Error ? e.message : "Mailtrap request failed",
    };
  }
}
