import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  freeCount,
  getEquipmentSettings,
  getOrderByToken,
  getProductsByIds,
  insertEquipmentEvent,
  moveOrderIfStatus,
  type EquipmentOrderFull,
  type EquipmentProduct,
  type EquipmentSettings,
} from "@/services/equipment";
import { addDays, dayLabel, isIsoDate } from "@/lib/equipment/dates";
import { quote } from "@/lib/equipment/pricing";
import { rands } from "@/lib/equipment/money";
import { sendManagerNote } from "@/lib/equipment/emails";

// POST /api/equipment/rental/[token] — public; the token in the emailed link
// is the key (frame 47a-6). Actions:
//   extend  { newEnd }  re-check availability past the current return date,
//                       price the difference and send it to the rental manager
//   issue   { text }    report a problem to the rental manager
//   cancel              withdraw a ministry request, or an unpaid checkout
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await getOrderByToken(admin, token);
  const order = data as EquipmentOrderFull | null;
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.action === "issue") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
    if (text.length < 5) return NextResponse.json({ error: "Tell us a little about what's wrong." }, { status: 400 });
    await insertEquipmentEvent(admin, { order_id: order.id, kind: "issue_reported", detail: text });
    await sendManagerNote(order, "issue", `${order.customer_name} reported an issue:\n\n${text}`);
    return NextResponse.json({ ok: true, message: "Sent. The rental manager will be in touch." });
  }

  if (body.action === "cancel") {
    const { data: moved } = await moveOrderIfStatus(admin, order.id, ["requested", "awaiting_payment"], {
      status: "cancelled",
      hold_expires_at: null,
    });
    if (!moved) {
      return NextResponse.json(
        { error: "This order is already confirmed. Reply to your confirmation email to cancel it." },
        { status: 409 }
      );
    }
    await insertEquipmentEvent(admin, { order_id: order.id, kind: "cancelled", detail: `Cancelled by ${order.customer_name}.` });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "extend") {
    if (!["requested", "confirmed", "prepping", "out"].includes(order.status)) {
      return NextResponse.json({ error: "This order can't be extended now." }, { status: 409 });
    }
    const newEnd = body.newEnd;
    if (!isIsoDate(newEnd) || newEnd <= order.ends_on) {
      return NextResponse.json({ error: "Pick a return date after the current one." }, { status: 400 });
    }
    if (newEnd > addDays(order.ends_on, 60)) {
      return NextResponse.json({ error: "Extensions can be up to 60 days. Ask us about anything longer." }, { status: 400 });
    }

    // Only the added days need checking: the order already holds its own dates.
    const from = addDays(order.ends_on, 1);
    const short: string[] = [];
    for (const l of order.lines) {
      const { data: free } = await freeCount(admin, l.product_id, from, newEnd, order.id);
      if ((free ?? 0) < l.quantity) {
        const p = l.product;
        short.push(`${p ? [p.brand, p.model].filter(Boolean).join(" ") || p.name : "An item"} (${free ?? 0} of ${l.quantity} free)`);
      }
    }
    if (short.length) {
      return NextResponse.json(
        { error: `Not everything is free until ${dayLabel(newEnd)}: ${short.join(", ")}.` },
        { status: 409 }
      );
    }

    // What the longer hire costs, less what's already charged.
    const { data: settings } = await getEquipmentSettings(admin);
    const { data: products } = await getProductsByIds(
      admin,
      order.lines.map((l) => l.product_id)
    );
    const byId = new Map(((products ?? []) as EquipmentProduct[]).map((p) => [p.id, p]));
    const q = quote(
      order.lines.filter((l) => byId.has(l.product_id)).map((l) => ({ product: byId.get(l.product_id)!, quantity: l.quantity })),
      order.starts_on,
      newEnd,
      order.kind,
      (settings as EquipmentSettings | null) ?? { vat_bps: 1500, waiver_bps: 1000 }
    );
    const extra = Math.max(0, q.totalCents - order.total_cents);

    const text = `${order.customer_name} wants to keep the gear until ${dayLabel(newEnd)} instead of ${dayLabel(order.ends_on)}. Everything is free for the extra days. ${
      order.kind === "internal" ? "It's a ministry order." : `The longer hire comes to ${rands(extra)} more, incl. VAT.`
    }`;
    await insertEquipmentEvent(admin, { order_id: order.id, kind: "extension_requested", detail: `${newEnd}|${extra}|${text}` });
    await sendManagerNote(order, "extend", text);
    return NextResponse.json({
      ok: true,
      extraCents: extra,
      message:
        order.kind === "internal" || extra === 0
          ? `Asked. Everything is free until ${dayLabel(newEnd)}; the rental manager will confirm.`
          : `Asked. Everything is free until ${dayLabel(newEnd)}. It comes to ${rands(extra)} more; the rental manager will confirm and send you the invoice.`,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
