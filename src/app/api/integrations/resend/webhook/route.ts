import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyProviderEvent,
  type NormalizedDeliveryEvent,
} from "@/lib/email/ledger";

// POST /api/integrations/resend/webhook
//
// Resend posts delivery events here (configure at resend.com → Webhooks,
// pointed at https://<site>/api/integrations/resend/webhook). Each event
// carries data.email_id — the id we stored on the email_messages row at
// send time — so we can advance that row from 'sent' to
// delivered/opened/bounced/complained.
//
// Signing: Resend uses Svix. We verify the svix-id / svix-timestamp /
// svix-signature triple against RESEND_WEBHOOK_SECRET (whsec_...). If the
// secret isn't configured yet we accept + log a warning, so wiring the
// endpoint before pasting the secret doesn't silently drop events —
// but set it: an unsigned public endpoint is spoofable.

export const runtime = "nodejs";

// Verify a Svix-style signature. signedContent = `${id}.${ts}.${body}`;
// the secret is base64 after the `whsec_` prefix; the header is a
// space-separated list of `v1,<base64sig>` — any match passes.
function verifySvix(
  secret: string,
  id: string | null,
  timestamp: string | null,
  signatureHeader: string | null,
  body: string
): boolean {
  if (!id || !timestamp || !signatureHeader) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  for (const part of signatureHeader.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    if (
      sigBuf.length === expectedBuf.length &&
      timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

// Map a Resend event type onto our normalized ledger status. Types we
// don't track (email.sent, email.delivery_delayed, email.scheduled) map
// to null and are acknowledged without touching the row.
function normalize(payload: {
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}): NormalizedDeliveryEvent | null {
  const emailId = payload.data?.email_id ?? payload.data?.id;
  if (!emailId) return null;
  const base = { providerMessageId: String(emailId), raw: payload };
  switch (payload.type) {
    case "email.delivered":
      return { ...base, status: "delivered" };
    case "email.opened":
    case "email.clicked":
      return { ...base, status: "opened" };
    case "email.bounced": {
      const kind = String(payload.data?.bounce?.type ?? "").toLowerCase();
      return {
        ...base,
        status: "bounced",
        bounceType: kind.includes("transient") ? "soft" : "hard",
        reason:
          payload.data?.bounce?.message ??
          payload.data?.bounce?.subType ??
          "bounced",
      };
    }
    case "email.complained":
      return { ...base, status: "complained", reason: "spam complaint" };
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();

  if (secret) {
    const ok = verifySvix(
      secret,
      request.headers.get("svix-id"),
      request.headers.get("svix-timestamp"),
      request.headers.get("svix-signature"),
      rawBody
    );
    if (!ok) {
      console.error("[resend/webhook] signature verification failed");
      return new NextResponse("invalid signature", { status: 401 });
    }
  } else {
    console.warn(
      "[resend/webhook] RESEND_WEBHOOK_SECRET not set — accepting unverified event"
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  const ev = normalize(payload as { type?: string; data?: unknown });
  if (!ev) return NextResponse.json({ ok: true, ignored: true });

  const admin = createAdminClient();
  const matched = await applyProviderEvent(admin, "resend", ev);

  // Hard bounces + complaints feed the same global suppression list the
  // Mailtrap webhook maintains — a bad address is bad on every channel.
  if (ev.status === "bounced" || ev.status === "complained") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const to = (payload as any)?.data?.to;
    const email = Array.isArray(to) ? to[0] : to;
    if (typeof email === "string" && email.includes("@")) {
      await admin.from("email_suppressions").upsert(
        {
          email_normalized: email.trim().toLowerCase(),
          reason: ev.status === "complained" ? "complaint" : "hard_bounce",
        },
        { onConflict: "email_normalized", ignoreDuplicates: true }
      );
    }
  }

  return NextResponse.json({ ok: true, matched });
}
