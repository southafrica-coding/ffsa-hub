// ============================================================
// Store — settle a paid order and tell people
// ============================================================
// Shared by the PayFast ITN and Media's "Mark EFT paid". Runs the guarded
// settle (services/store.ts), then sends: the buyer's confirmation, one
// gift email per gift code, and a notice to Media. Emails are best-effort
// and flag-guarded (STORE_EMAILS_ENABLED); a failed email never undoes a
// payment.
// ============================================================

import "server-only";
import { settleStoreOrder, listEntitlementsFor, listCodesForItems } from "@/services/store";
import { appUrl } from "./flags";
import { planSettlement } from "./settle";
import { giftEmail, mediaNoticeEmail, mediaNotifyAddresses, orderConfirmationEmail, sendStoreEmail, type StoreEmailSender } from "./emails";
import type { StoreCode, StoreEntitlement, StoreOrderItem } from "./types";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function settleAndNotify(
  admin: Client,
  input: { orderId: string; providerPaymentId?: string | null; markedPaidBy?: string | null },
  send: StoreEmailSender = sendStoreEmail
): Promise<"settled" | "already" | "error"> {
  // Current subscription ends, so renewing extends rather than overlaps.
  const { data: pre } = await admin.from("store_orders").select("buyer_email, buyer_user_id").eq("id", input.orderId).maybeSingle();
  const currentEnds = new Map<string, Date>();
  if (pre) {
    const { data: ents } = await listEntitlementsFor(admin, { userId: pre.buyer_user_id, email: pre.buyer_email });
    for (const e of (ents ?? []) as StoreEntitlement[]) {
      if (!e.expires_at || e.revoked_at) continue;
      const end = new Date(e.expires_at);
      const cur = currentEnds.get(e.product_id);
      if (!cur || end > cur) currentEnds.set(e.product_id, end);
    }
  }

  const result = await settleStoreOrder(admin, {
    orderId: input.orderId,
    providerPaymentId: input.providerPaymentId,
    markedPaidBy: input.markedPaidBy,
    planFor: (order, items, products) => planSettlement(order, items, products, { currentEnds }),
  });
  if (result.outcome !== "settled") {
    if (result.outcome === "error") console.error("[store/settle]", input.orderId, result.error);
    return result.outcome;
  }

  const { order } = result;
  const { data: itemRows } = await admin.from("store_order_items").select("*").eq("order_id", order.id);
  const items = (itemRows ?? []) as StoreOrderItem[];
  const base = appUrl();

  try {
    const confirmation = orderConfirmationEmail(order, items, { library: `${base}/store/library`, orders: `${base}/store/orders` });
    await send({ to: order.buyer_email, ...confirmation, category: "store_order_confirmation", sourceId: order.id });

    const giftItems = items.filter((i) => i.purpose === "gift");
    if (giftItems.length) {
      const { data: codes } = await listCodesForItems(admin, giftItems.map((i) => i.id));
      for (const code of (codes ?? []) as StoreCode[]) {
        if (code.kind !== "gift" || !code.recipient_email) continue;
        const item = giftItems.find((i) => i.id === code.order_item_id);
        const mail = giftEmail({
          fromName: order.buyer_name,
          title: item?.title ?? "a gift",
          code: code.code,
          message: item?.gift_message ?? null,
          redeemUrl: `${base}/store/redeem?code=${encodeURIComponent(code.code)}`,
        });
        await send({ to: code.recipient_email, ...mail, category: "store_gift", sourceId: order.id });
      }
    }

    const short = result.stockShort.length ? "Some sizes ran out between checkout and payment. Check stock before packing." : undefined;
    for (const to of mediaNotifyAddresses()) {
      const notice = mediaNoticeEmail(order, items, `${base}/store/admin/orders/${order.id}`, short);
      await send({ to, ...notice, category: "store_media_notice", sourceId: order.id });
    }
  } catch (e) {
    console.error("[store/settle] email step failed for", order.id, e instanceof Error ? e.message : e);
  }
  return "settled";
}
