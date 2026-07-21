// FFSA Hub — PayFast payment provider (South African cards).
//
// PayFast has no SDK: checkout is a signed redirect to PayFast's
// hosted page, and confirmation arrives as a server-to-server
// ITN (Instant Transaction Notification) POST. This adapter
// implements the PaymentProvider interface for PayFast.
//
// PayFast's signature is fussy about field order and character
// escaping — exercise this against the PayFast SANDBOX
// (PAYFAST_MODE=sandbox) before any live use.

import { createHash } from "node:crypto";
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  PaymentStatus,
  RefundOutcome,
  RefundRequest,
  WebhookRequest,
  WebhookResult,
} from "./provider";

const ENDPOINTS = {
  sandbox: {
    process: "https://sandbox.payfast.co.za/eng/process",
    validate: "https://sandbox.payfast.co.za/eng/query/validate",
  },
  live: {
    process: "https://www.payfast.co.za/eng/process",
    validate: "https://www.payfast.co.za/eng/query/validate",
  },
} as const;

// The REST API (refunds, queries) is a different surface from the
// checkout redirect above: one host for both modes, its own auth
// headers, and its own signature scheme. See apiSignature().
const API_BASE = "https://api.payfast.co.za";
const API_VERSION = "v1";

type PayfastConfig = {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  mode: "sandbox" | "live";
};

function loadConfig(): PayfastConfig {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  if (!merchantId || !merchantKey) {
    throw new Error(
      "PayFast is not configured — set PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY.",
    );
  }
  return {
    merchantId,
    merchantKey,
    passphrase: process.env.PAYFAST_PASSPHRASE ?? "",
    mode: process.env.PAYFAST_MODE === "live" ? "live" : "sandbox",
  };
}

// PayFast signs values with PHP urlencode() semantics: spaces as
// "+", uppercase percent-encoding, the same escaped character set.
// encodeURIComponent already uppercases its hex; we fix spaces and
// the handful of characters it leaves bare.
function payfastEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// MD5 of "name=value&..." in the given order, with the passphrase
// (if any) appended last. PayFast signs both checkout requests and
// ITNs this way.
function signature(pairs: [string, string][], passphrase: string): string {
  const parts = pairs.map(([k, v]) => `${k}=${payfastEncode(v)}`);
  if (passphrase) parts.push(`passphrase=${payfastEncode(passphrase)}`);
  return createHash("md5").update(parts.join("&")).digest("hex");
}

function toRands(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

// ────────────────────────────────────────────────────────────
// REST API auth (refunds)
// ------------------------------------------------------------
// DIFFERENT from the checkout signature above, and the difference
// is easy to miss: checkout signs fields in SUBMISSION order, the
// API signs every header + query + body field sorted ALPHABETICALLY,
// with `passphrase` sorted in among them rather than appended last.
// Same MD5-of-a-query-string shape, same PHP urlencode() semantics.
// ────────────────────────────────────────────────────────────
function apiSignature(
  fields: Record<string, string | number>,
  passphrase: string
): string {
  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "signature") continue;
    all[k] = String(v);
  }
  if (passphrase) all.passphrase = passphrase;

  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${k}=${payfastEncode(all[k])}`)
    .join("&");
  return createHash("md5").update(paramString).digest("hex");
}

// PayFast's API wants PHP's date("Y-m-d\TH:i:sO") — an ISO-ish stamp
// with a numeric offset and NO colon in it, and no milliseconds.
// Date.toISOString() gives neither, so build it explicitly in UTC.
function apiTimestamp(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 19)}+0000`;
}

type ApiCall = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, string | number>;
};

function buildApiRequest(cfg: PayfastConfig, call: ApiCall) {
  const headers: Record<string, string> = {
    "merchant-id": cfg.merchantId,
    version: API_VERSION,
    timestamp: apiTimestamp(),
  };
  headers.signature = apiSignature(
    { ...headers, ...(call.body ?? {}) },
    cfg.passphrase
  );
  return {
    url: `${API_BASE}/${call.path}`,
    headers: { ...headers, "Content-Type": "application/json" },
    body: call.body,
  };
}

// PayFast wraps successful responses as { data: { response: ... } } but
// isn't consistent across endpoints, and error bodies vary too. Dig for
// the useful bits rather than trusting one shape.
type PayfastJson = Record<string, unknown>;

function pluck(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as PayfastJson;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  for (const v of Object.values(rec)) {
    if (v && typeof v === "object") {
      const found = pluck(v, keys);
      if (found) return found;
    }
  }
  return null;
}

// PayFast refund states seen in the wild: PENDING / PROCESSING while the
// payout is queued, COMPLETE once it lands, FAILED / CANCELLED otherwise.
// Anything unrecognised stays pending so we never claim a false success.
function mapRefundStatus(raw: string | null): "succeeded" | "pending" | "failed" {
  switch ((raw ?? "").toUpperCase()) {
    case "COMPLETE":
    case "COMPLETED":
    case "SUCCESS":
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
    case "CANCELLED":
    case "CANCELED":
    case "REJECTED":
      return "failed";
    default:
      return "pending";
  }
}

function mapStatus(raw: string | null): PaymentStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "COMPLETE":
      return "paid";
    case "CANCELLED":
      return "cancelled";
    case "PENDING":
      return "pending";
    default:
      return "failed";
  }
}

export const payfastProvider: PaymentProvider = {
  name: "payfast",

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const cfg = loadConfig();

    // Field order matters — PayFast signs fields in submission order.
    const pairs: [string, string][] = [
      ["merchant_id", cfg.merchantId],
      ["merchant_key", cfg.merchantKey],
      ["return_url", req.returnUrl],
      ["cancel_url", req.cancelUrl],
      ["notify_url", req.notifyUrl],
      ["name_first", req.buyer.firstName],
      ["name_last", req.buyer.lastName],
      ["email_address", req.buyer.email],
      ["m_payment_id", req.orderId],
      ["amount", toRands(req.amountCents)],
      ["item_name", req.description],
    ];

    const query = pairs
      .map(([k, v]) => `${k}=${payfastEncode(v)}`)
      .concat(`signature=${signature(pairs, cfg.passphrase)}`)
      .join("&");

    return {
      redirectUrl: `${ENDPOINTS[cfg.mode].process}?${query}`,
      reference: req.orderId,
    };
  },

  async refundPayment(req: RefundRequest): Promise<RefundOutcome> {
    const cfg = loadConfig();

    // The API signature is meaningless without the passphrase, and
    // PayFast only enables the REST API on request — fail loudly
    // rather than sending an unsignable request.
    if (!cfg.passphrase) {
      return {
        status: "failed",
        providerRefundId: null,
        amountCents: null,
        error:
          "PayFast refunds need PAYFAST_PASSPHRASE set (and API access enabled on the merchant account). Record this as a manual refund instead.",
      };
    }

    const body: Record<string, string | number> = {
      // PayFast takes the refund amount in CENTS, same unit as
      // orders.total_cents — do not convert to rands here.
      amount: req.amountCents,
      // The Hub sends its own branded refund email, so PayFast's
      // notice is off unless a caller explicitly asks for it.
      notify_buyer: req.notifyBuyer ? 1 : 0,
    };
    if (req.reason) body.reason = req.reason.slice(0, 255);

    const built = buildApiRequest(cfg, {
      method: "POST",
      path: `refunds/${encodeURIComponent(req.providerPaymentId)}`,
      body,
    });

    if (req.dryRun) {
      return {
        status: "pending",
        providerRefundId: null,
        amountCents: req.amountCents,
        error: null,
        dryRunPreview: {
          method: "POST",
          url: built.url,
          // Signature included deliberately: verifying it against a
          // known-good PayFast example is the whole point of dry-run.
          headers: built.headers,
          body: built.body,
        },
      };
    }

    // PayFast's own SDK refuses outright in sandbox ("Sorry but Refunds
    // is not available in Sandbox mode"), so there is no test path here.
    if (cfg.mode !== "live") {
      return {
        status: "failed",
        providerRefundId: null,
        amountCents: null,
        error:
          "PayFast does not support refunds in sandbox mode. Set PAYFAST_MODE=live to refund for real, or record this as a manual refund.",
      };
    }

    let res: Response;
    try {
      res = await fetch(built.url, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
      });
    } catch (err) {
      return {
        status: "failed",
        providerRefundId: null,
        amountCents: null,
        error: `Could not reach PayFast: ${err instanceof Error ? err.message : "network error"}`,
      };
    }

    const text = await res.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (HTML error page) — surfaced via the raw text below.
    }

    if (!res.ok) {
      return {
        status: "failed",
        providerRefundId: null,
        amountCents: null,
        error:
          pluck(json, ["message", "error", "errors"]) ??
          `PayFast returned ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      };
    }

    // A 200 means PayFast ACCEPTED the refund, not that it has settled —
    // the payout is queued and there is no ITN for refunds. The caller
    // records it as pending and syncs later via fetchRefund.
    const refundId = pluck(json, ["uuid", "id", "refund_id"]);
    const reported = pluck(json, ["status"]);
    return {
      status: reported ? mapRefundStatus(reported) : "pending",
      providerRefundId: refundId,
      amountCents: req.amountCents,
      error: null,
    };
  },

  async fetchRefund(providerRefundId: string): Promise<RefundOutcome> {
    const cfg = loadConfig();
    if (!cfg.passphrase) {
      return {
        status: "pending",
        providerRefundId,
        amountCents: null,
        error: "PayFast refund status needs PAYFAST_PASSPHRASE set.",
      };
    }

    const built = buildApiRequest(cfg, {
      method: "GET",
      path: `refunds/${encodeURIComponent(providerRefundId)}`,
    });

    try {
      const res = await fetch(built.url, {
        method: "GET",
        headers: built.headers,
      });
      const text = await res.text().catch(() => "");
      const json: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) {
        return {
          status: "pending",
          providerRefundId,
          amountCents: null,
          error:
            pluck(json, ["message", "error"]) ??
            `PayFast returned ${res.status} when checking the refund.`,
        };
      }
      const amount = pluck(json, ["amount"]);
      return {
        status: mapRefundStatus(pluck(json, ["status"])),
        providerRefundId,
        amountCents: amount ? Number.parseInt(amount, 10) : null,
        error: null,
      };
    } catch (err) {
      // Unreachable / unparseable — leave it pending, never guess.
      return {
        status: "pending",
        providerRefundId,
        amountCents: null,
        error: err instanceof Error ? err.message : "Unknown PayFast error.",
      };
    }
  },

  async verifyWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const cfg = loadConfig();
    const posted = new URLSearchParams(req.rawBody);

    // Recompute the signature over every posted field except
    // `signature`, in the order received.
    const signedPairs: [string, string][] = [];
    posted.forEach((value, key) => {
      if (key !== "signature") signedPairs.push([key, value]);
    });
    if (signature(signedPairs, cfg.passphrase) !== (posted.get("signature") ?? "")) {
      throw new Error("PayFast ITN rejected: signature mismatch.");
    }

    // Server-to-server postback — PayFast itself must confirm it
    // sent this exact payload.
    const postback = await fetch(ENDPOINTS[cfg.mode].validate, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: req.rawBody,
    });
    const verdict = (await postback.text().catch(() => "")).trim();
    if (verdict !== "VALID") {
      throw new Error(`PayFast ITN rejected: postback returned "${verdict}".`);
    }

    const orderId = posted.get("m_payment_id");
    if (!orderId) {
      throw new Error("PayFast ITN rejected: missing m_payment_id.");
    }

    const gross = posted.get("amount_gross");
    return {
      orderId,
      status: mapStatus(posted.get("payment_status")),
      providerPaymentId: posted.get("pf_payment_id"),
      amountCents: gross ? Math.round(Number.parseFloat(gross) * 100) : null,
    };
  },
};
