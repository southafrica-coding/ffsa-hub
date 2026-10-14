import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncInvoicePayments } from "@/services/billing-payments";

// Xero webhook — Xero calls this when an invoice changes (e.g. a payment is
// applied), in either organisation, so school-fee balances update without
// waiting for the daily catch-up.
//
// Setup (Xero developer portal → the Hub's app → Webhooks):
//   Delivery URL  https://ffsahub.com/api/integrations/xero/webhook
//   Events        Invoices
//   Webhook key   → Vercel env XERO_WEBHOOK_KEY
//
// Xero signs every delivery with that key (HMAC-SHA256, base64, header
// x-xero-signature). A wrong signature must get a 401 with an empty body —
// that's also how Xero's "intent to receive" check proves the endpoint
// verifies. Xero wants a 200 within 5 seconds, so the sync runs after the
// response.

export const maxDuration = 60;

interface XeroEvent {
  resourceId?: string;
  eventCategory?: string;
  eventType?: string;
  tenantId?: string;
}

function validSignature(raw: string, header: string | null, key: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(createHmac("sha256", key).update(raw, "utf8").digest("base64"));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function POST(request: Request) {
  const key = process.env.XERO_WEBHOOK_KEY;
  const raw = await request.text();
  if (!key || !validSignature(raw, request.headers.get("x-xero-signature"), key)) {
    return new NextResponse(null, { status: 401 });
  }

  let events: XeroEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: XeroEvent[] }).events ?? [];
  } catch {
    // Signed but unparseable — acknowledge so Xero doesn't retry forever.
    return new NextResponse(null, { status: 200 });
  }

  const invoiceIds = events
    .filter((e) => e.eventCategory === "INVOICE" && e.resourceId)
    .map((e) => e.resourceId!);

  if (invoiceIds.length > 0) {
    after(async () => {
      try {
        // Ids the Hub didn't make (most Xero invoices) match no charges and
        // are ignored inside the sync.
        const res = await syncInvoicePayments(createAdminClient(), { invoiceIds });
        if (res.chargesUpdated || res.errors.length || res.voided.length) {
          console.log("[xero/webhook]", JSON.stringify({ ...res, received: invoiceIds.length }));
        }
      } catch (err) {
        console.error("[xero/webhook] sync failed", err);
      }
    });
  }

  return new NextResponse(null, { status: 200 });
}
