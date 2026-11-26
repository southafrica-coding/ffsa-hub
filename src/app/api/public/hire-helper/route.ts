import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import { rangeLabel, sastToday } from "@/lib/equipment/dates";
import { HIRE_EMAIL, helperRange, parseHelperAnswers, summariseAnswers, summaryText } from "@/lib/equipment/helper";
import { notifyHireQuoteRequest } from "@/lib/email/send-hire-quote-request";
import { insertQuoteRequest } from "@/services/equipment-helper";

/**
 * The event helper's answers (/hire/helper). Public: the customer has no
 * account. The body can set only the questions in parseHelperAnswers, and
 * the request always lands as an external order in status `quote` (which
 * holds no gear), with the answers in its notes, for the rental manager
 * to work out the gear and price it by hand.
 */

const LIMIT = { limit: 4, windowSeconds: 60 * 60 };

export async function POST(request: Request) {
  const limited = await getRateLimiter().hit(`hire-helper:${clientIp(request)}`, LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: `Too many requests from this connection. Try again later, or email ${HIRE_EMAIL}.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limited)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const parsed = parseHelperAnswers(body, sastToday());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const a = parsed.value;
  const { from, to } = helperRange(a);
  const summary = summariseAnswers(a);

  const { data: order, error } = await insertQuoteRequest(createAdminClient(), {
    customer_name: a.name,
    customer_email: a.email,
    customer_phone: a.phone,
    customer_org: a.org ?? null,
    starts_on: from,
    ends_on: to,
    notes: summaryText(summary),
  });
  if (error || !order) {
    console.error("[hire-helper] quote insert failed:", error?.message);
    return NextResponse.json({ error: `We couldn't send your answers. Try again, or email ${HIRE_EMAIL}.` }, { status: 500 });
  }

  after(() =>
    notifyHireQuoteRequest({
      orderId: order.id,
      orderNumber: order.number,
      customerName: a.name,
      customerEmail: a.email,
      whenLabel: rangeLabel(from, to),
      summary,
    })
  );

  return NextResponse.json({ ok: true, number: order.number });
}
