import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  freeCount,
  getEquipmentAccess,
  getOrderById,
  insertEquipmentEvent,
  moveOrderIfStatus,
  type EquipmentOrderFull,
} from "@/services/equipment";
import { addDays, dayLabel, isIsoDate } from "@/lib/equipment/dates";
import { sendRequestDecision } from "@/lib/equipment/emails";

// POST /api/equipment/orders/[id] — rental manager actions (frame 47d phone).
//   approve  { note? }    requested → confirmed, email the asker
//   decline  { reason }   requested → declined (releases the hold), email the asker
//   extend   { newEnd }   apply an extension: re-check the added days, move ends_on
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the rental manager can do that." }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await getOrderById(supabase, id);
  const order = data as EquipmentOrderFull | null;
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const note = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

  if (body.action === "approve" || body.action === "decline") {
    const approve = body.action === "approve";
    if (!approve && note.length < 3) {
      return NextResponse.json({ error: "Say why, so they know what to change." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { data: moved } = await moveOrderIfStatus(
      supabase,
      id,
      ["requested"],
      approve
        ? { status: "confirmed", approved_by: user.id, approved_at: now }
        : { status: "declined", approved_by: user.id, approved_at: now, decline_reason: note }
    );
    if (!moved) return NextResponse.json({ error: "This request has already been decided." }, { status: 409 });
    await insertEquipmentEvent(admin, {
      order_id: id,
      kind: approve ? "approved" : "declined",
      detail: approve ? note || "Approved." : note,
      actor_id: user.id,
    });
    await sendRequestDecision({ ...order, status: approve ? "confirmed" : "declined" }, approve, note || null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "extend") {
    const newEnd = body.newEnd;
    if (!isIsoDate(newEnd) || newEnd <= order.ends_on) {
      return NextResponse.json({ error: "Pick a return date after the current one." }, { status: 400 });
    }
    for (const l of order.lines) {
      const { data: free } = await freeCount(admin, l.product_id, addDays(order.ends_on, 1), newEnd, id);
      if ((free ?? 0) < l.quantity) {
        return NextResponse.json({ error: `Not everything is free until ${dayLabel(newEnd)} any more.` }, { status: 409 });
      }
    }
    const { data: moved } = await moveOrderIfStatus(supabase, id, ["requested", "confirmed", "prepping", "out"], {
      ends_on: newEnd,
    });
    if (!moved) return NextResponse.json({ error: "This order can't be extended now." }, { status: 409 });
    await insertEquipmentEvent(admin, {
      order_id: id,
      kind: "extended",
      detail: `Return moved from ${order.ends_on} to ${newEnd}.`,
      actor_id: user.id,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
