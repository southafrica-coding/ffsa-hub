import { NextResponse } from "next/server";
import { z } from "zod";
import { fulfilmentEmail, sendStoreEmail } from "@/lib/store/emails";
import { appUrl } from "@/lib/store/flags";
import { canMoveFulfilment } from "@/lib/store/settle";
import type { FulfilmentStatus } from "@/lib/store/types";
import { getFulfilment, getOrder, moveFulfilment } from "@/services/store";
import { readJson } from "../../../../_shared";
import { requireStoreStaff } from "../../../_guard";

const schema = z.object({
  status: z.enum(["preorder", "to_pack", "ready_to_collect", "shipped", "collected", "delivered"]),
  tracking: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// POST /api/store/admin/orders/[id]/fulfilment — move a parcel on one step
// and email the buyer.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Pick the next step" }, { status: 400 });

  const [{ data: order }, { data: current }] = await Promise.all([getOrder(guard.supabase, id), getFulfilment(guard.supabase, id)]);
  if (!order || !current) return NextResponse.json({ error: "Nothing to fulfil on this order" }, { status: 404 });
  const to = parsed.data.status as FulfilmentStatus;
  if (!canMoveFulfilment(current.method, current.status, to)) {
    return NextResponse.json({ error: "That step doesn't follow from where the order is" }, { status: 409 });
  }
  const { data, error } = await moveFulfilment(guard.supabase, id, current.status, {
    status: to,
    tracking: parsed.data.tracking ?? current.tracking,
    notes: parsed.data.notes ?? current.notes,
    updated_by: guard.userId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Someone moved this order just now. Refresh." }, { status: 409 });

  const mail = fulfilmentEmail(order, to, data.tracking, `${appUrl()}/store/orders`);
  await sendStoreEmail({ to: order.buyer_email, ...mail, category: "store_fulfilment", sourceId: order.id });
  return NextResponse.json({ success: true, fulfilment: data });
}
