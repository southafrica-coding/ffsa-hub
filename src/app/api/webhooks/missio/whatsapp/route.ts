/**
 * /api/webhooks/missio/whatsapp — Meta's webhook for the Missio WhatsApp number.
 *
 * Public (no session: Meta has no cookie), so this exact prefix is in the
 * middleware publicRoutes list. Everything is authorised here instead:
 *
 *   GET   the subscribe handshake. hub.verify_token must equal
 *         MISSIO_WHATSAPP_VERIFY_TOKEN (timing-safe) → echo hub.challenge.
 *         Wrong token 403; no token configured 503.
 *   POST  read the RAW body, check X-Hub-Signature-256 against
 *         MISSIO_WHATSAPP_APP_SECRET (HMAC-SHA256, timing-safe) → 401 if bad.
 *         Only then parse, and store inbound messages and status updates
 *         for the Missio number (service role; idempotent on wamid).
 *         No secret configured 503; database update 396 missing 503, so
 *         Meta retries once it's applied.
 *
 * The store is a handful of small writes, so it runs in the request and the
 * 200 means it's stored. The menu bot (397) is only scheduled here, for
 * newly stored messages: it runs after the response (next/server after()),
 * so Graph is never called inside this request. See lib/missio/whatsapp/bot.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { webhookPhoneNumberId, webhookSecret, webhookVerifyToken } from "@/lib/missio/whatsapp/config";
import { verifyHandshake, verifyMetaSignature } from "@/lib/missio/whatsapp/signature";
import { WhatsAppNotInstalledError } from "@/lib/missio/whatsapp/store";
import { supabaseWhatsAppStore } from "@/lib/missio/whatsapp/supabase-store";
import { handleWebhook, type WebhookPayload } from "@/lib/missio/whatsapp/webhook";
import { scheduleBotWork } from "@/lib/missio/whatsapp/bot/schedule";

export const dynamic = "force-dynamic";

const plain = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const token = webhookVerifyToken();
  if (!token) return plain("not_configured", 503);
  const result = verifyHandshake(new URL(request.url).searchParams, token);
  return result.ok ? plain(result.challenge, 200) : plain("forbidden", 403);
}

export async function POST(request: Request) {
  const secret = webhookSecret();
  const phoneNumberId = webhookPhoneNumberId();
  if (!secret || !phoneNumberId) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const outcome = await handleWebhook(payload, supabaseWhatsAppStore(createAdminClient()), { phoneNumberId });
    scheduleBotWork(outcome.jobs);
  } catch (error) {
    if (error instanceof WhatsAppNotInstalledError) return NextResponse.json({ error: "not_installed" }, { status: 503 });
    console.error("[missio-whatsapp] webhook failed", error instanceof Error ? error.message : "unknown");
    // Non-200 so Meta retries; every write is idempotent on wamid.
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
