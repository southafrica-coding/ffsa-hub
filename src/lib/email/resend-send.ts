// Resend send wrappers for marketing + brand mail — campaigns, workflow
// emails, ticket confirmations, refund and cancellation notices.
//
// These replaced the Mailtrap transport. Resend has no hourly quota, so
// campaigns are no longer throttled to a drip; they go out through the batch
// endpoint, 100 recipients per request.
//
// Like the Mailtrap wrapper before it, nothing here throws: every failure comes
// back as an `error` string, and `rateLimited` flags "try again later" (a
// per-second rate limit we couldn't ride out, or a daily/monthly plan quota).
// Callers must treat rateLimited as transient — stop the run without recording
// the recipient, so a later run retries them.

import { getResend, isEmailConfigured } from "@/lib/email/resend";

export { isEmailConfigured };

export type ResendAttachment = {
  filename: string;
  /** Already-encoded base64 string of the file bytes. */
  contentBase64: string;
  /** MIME type. ICS invites use 'text/calendar; method=REQUEST'. */
  type: string;
};

export type ResendSendInput = {
  fromEmail: string;
  fromName: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  /** Plain-text alternative — pair with html for proper multipart/alternative. */
  text?: string;
  /**
   * Grouping label, e.g. "campaign:<id>" or "ticket_confirmation". Sent as a
   * Resend tag so the Resend dashboard can be filtered by it.
   */
  category?: string;
  /**
   * Custom headers. Standard set for marketing email:
   *   List-Unsubscribe        — RFC 2369 unsubscribe URL
   *   List-Unsubscribe-Post   — RFC 8058 one-click unsubscribe signal
   *   List-ID                 — RFC 2919 list identifier
   *   Precedence: bulk        — flags as bulk mail
   */
  headers?: Record<string, string>;
  /** Not supported by sendBatchViaResend — Resend's batch API has no attachments. */
  attachments?: ResendAttachment[];
};

export type ResendSendResult = {
  messageId: string | null;
  error: string | null;
  rateLimited?: boolean;
};

// Error names that mean "not now", rather than "never".
const TRANSIENT = new Set([
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "concurrent_idempotent_requests",
]);

// Resend's per-second request limit is short-lived; a brief wait clears it.
const RATE_LIMIT_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tag values may only contain ASCII letters, digits, `_` and `-`. */
function tagsFor(category: string | undefined) {
  if (!category) return undefined;
  const [kind, ...rest] = category.split(":");
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
  const tags = [{ name: "category", value: clean(kind) }];
  if (rest.length > 0) tags.push({ name: "ref", value: clean(rest.join(":")) });
  return tags;
}

function payloadFor(input: ResendSendInput) {
  return {
    from: `${input.fromName.replace(/[<>"]/g, "")} <${input.fromEmail}>`,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.headers && Object.keys(input.headers).length > 0
      ? { headers: input.headers }
      : {}),
    ...(input.category ? { tags: tagsFor(input.category) } : {}),
  };
}

/** Send a single email through Resend. Never throws — returns an error string. */
export async function sendViaResend(
  input: ResendSendInput
): Promise<ResendSendResult> {
  if (!isEmailConfigured()) {
    return { messageId: null, error: "RESEND_API_KEY is not configured" };
  }

  const payload = {
    ...payloadFor(input),
    ...(input.attachments && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.contentBase64, "base64"),
            contentType: a.type,
          })),
        }
      : {}),
  };

  try {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await getResend().emails.send(payload);
      if (!error) {
        return data?.id
          ? { messageId: data.id, error: null }
          : { messageId: null, error: "Resend returned no message id" };
      }
      if (error.name === "rate_limit_exceeded" && attempt < RATE_LIMIT_RETRIES) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return {
        messageId: null,
        error: `Resend ${error.name}: ${error.message}`.slice(0, 300),
        rateLimited: TRANSIENT.has(error.name),
      };
    }
  } catch (e) {
    return {
      messageId: null,
      error: e instanceof Error ? e.message : "Resend request failed",
    };
  }
}

export type ResendBatchResult = {
  /** One entry per input email, in input order. */
  results: ResendSendResult[];
  /**
   * Set when the whole request was refused as "try later". No email in the
   * batch was sent, and none should be recorded.
   */
  rateLimited: boolean;
  /** A request-level failure that applies to every email in the batch. */
  error: string | null;
};

/**
 * Send up to 100 emails in one Resend request.
 *
 * `idempotencyKey` makes a retry of the same batch a no-op on Resend's side:
 * if the function dies after Resend accepted the batch but before we recorded
 * it, the resumed run rebuilds the identical batch, sends the same key, and
 * Resend answers with the original ids instead of emailing everyone twice.
 *
 * Permissive validation: one malformed address fails only itself, not the
 * other 99.
 */
export async function sendBatchViaResend(
  inputs: ResendSendInput[],
  idempotencyKey?: string
): Promise<ResendBatchResult> {
  const fail = (error: string, rateLimited = false): ResendBatchResult => ({
    results: inputs.map(() => ({ messageId: null, error, rateLimited })),
    rateLimited,
    error,
  });
  if (inputs.length === 0) return { results: [], rateLimited: false, error: null };
  if (inputs.length > 100) return fail("Resend batches are capped at 100 emails");
  if (!isEmailConfigured()) return fail("RESEND_API_KEY is not configured");

  try {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await getResend().batch.send(
        inputs.map(payloadFor),
        { batchValidation: "permissive", idempotencyKey }
      );
      if (error) {
        if (error.name === "rate_limit_exceeded" && attempt < RATE_LIMIT_RETRIES) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        const msg = `Resend ${error.name}: ${error.message}`.slice(0, 300);
        return fail(msg, TRANSIENT.has(error.name));
      }

      // Permissive mode: `data` lists the accepted emails in input order with
      // the rejected ones left out; `errors` names each rejected index.
      const errorsByIndex = new Map<number, string>();
      for (const e of data?.errors ?? []) errorsByIndex.set(e.index, e.message);
      // If the list is full-length, read it positionally instead, so a
      // differently-shaped response can never shift ids onto the wrong person.
      const ids = data?.data ?? [];
      const positional = ids.length === inputs.length;
      let next = 0;
      const results = inputs.map((_, i): ResendSendResult => {
        const rejected = errorsByIndex.get(i);
        if (rejected !== undefined) {
          return { messageId: null, error: `Resend rejected: ${rejected}`.slice(0, 300) };
        }
        const id = positional ? ids[i]?.id : ids[next++]?.id;
        return id
          ? { messageId: id, error: null }
          : { messageId: null, error: "Resend returned no message id" };
      });
      return { results, rateLimited: false, error: null };
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Resend request failed");
  }
}
