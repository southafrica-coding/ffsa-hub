import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { storeAdminClient } from "@/lib/store/db";
import { canActOnOrder } from "@/lib/store/signing";
import { eftDetails } from "@/lib/store/emails";
import { formatZar } from "@/lib/store/money";
import type { StoreOrder } from "@/lib/store/types";
import { getOrder } from "@/services/store";
import { EftProofForm, PendingRefresh } from "./thanks-client";

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };
export const dynamic = "force-dynamic";

// /store/thanks?order=<uuid>&t=<token> — after PayFast returns, or after an
// EFT order. The order id alone opens nothing: the link carries a signed
// order token (src/lib/store/signing.ts), or the signed-in buyer who placed
// the order may open it without one. The page shows status and payment
// details, nothing personal beyond the email it went to.
export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ order?: string; t?: string }> }) {
  const { order: id, t: token } = await searchParams;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await getOrder(storeAdminClient(), id);
  const order = data as StoreOrder | null;
  if (!order) notFound();
  const buyer = await getBuyer(await createClient());
  if (!canActOnOrder(order, { token, buyer })) notFound();
  const bank = eftDetails();

  const paid = order.status === "paid";
  const pendingEft = order.status === "pending" && order.payment_method === "eft";
  const pendingCard = order.status === "pending" && (order.payment_method === "payfast" || order.payment_method === "stripe");

  return (
    <div className="mx-auto max-w-[640px] px-4 pt-10 md:pt-16">
      <div className="masthead-context">Order {order.reference}</div>
      <h1 className="masthead-title">{paid ? "It's yours" : pendingEft ? "Almost there" : pendingCard ? "Confirming payment" : "Order closed"}</h1>

      {paid && (
        <div className="mt-6 space-y-5">
          {order.payment_method === "free" ? (
            <div className="border-l-[3px] border-yellow bg-bone px-4 py-3">
              <p className="mono-label">Nothing to pay</p>
              <p className="mt-1 text-[15px]">Your code covered the whole order. It&apos;s settled, with nothing charged.</p>
            </div>
          ) : (
            (order.discount_cents ?? 0) > 0 && (
              <p className="text-[14px] text-[color:var(--text-secondary)]">
                Paid {formatZar(order.total_cents)}, with {formatZar(order.discount_cents)} off from your code.
              </p>
            )
          )}
          <p className="text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            We&apos;ve emailed a receipt to {order.buyer_email}. Anything you read is in My Library; sign in with that email.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/store/library" className="inline-flex min-h-12 items-center border border-ink bg-ink px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--ink-bg-hover)]">Open My Library</Link>
            <Link href="/store" className="inline-flex min-h-12 items-center border border-ink px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-bone">Back to the Store</Link>
          </div>
        </div>
      )}

      {pendingCard && (
        <div className="mt-6 space-y-3">
          <p className="text-[15px] leading-relaxed text-[color:var(--text-secondary)]">{order.payment_method === "stripe" ? "Stripe" : "PayFast"} is confirming your payment. This page updates by itself, usually within a minute.</p>
          <PendingRefresh />
        </div>
      )}

      {pendingEft && (
        <div className="mt-6 space-y-6">
          <p className="text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            Pay the amount below from your bank with the reference exactly as shown. We&apos;ll confirm it once it reflects (usually 1–2 working days) and email {order.buyer_email}.
          </p>
          <dl className="grid grid-cols-2 border-t border-ink">
            {[
              ["Amount", formatZar(order.total_cents)],
              ["Reference", order.reference],
              ...(bank ? [["Bank", bank.bank], ["Account name", bank.accountName], ["Account number", bank.accountNumber], ["Branch code", bank.branchCode]] : []),
            ].map(([k, v], i) => (
              <div key={k} className={`border-b border-rule py-3 ${i % 2 ? "pl-4" : "pr-4"}`}>
                <dt className="mono-label">{k}</dt>
                <dd className={k === "Amount" || k === "Reference" ? "numeral mt-1 text-[26px]" : "mt-1 font-semibold tabular-nums"}>{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <div className="mono-label mb-2">Paid already? Speed it up</div>
            {order.eft_proof_path ? <p className="text-[14px]">Thanks, we have your proof of payment.</p> : <EftProofForm orderId={order.id} token={token ?? null} />}
          </div>
        </div>
      )}

      {(order.status === "cancelled" || order.status === "refunded") && (
        <p className="mt-6 text-[15px] text-[color:var(--text-secondary)]">
          This order was {order.status}. Nothing more is owed. <Link href="/store" className="underline decoration-yellow decoration-2 underline-offset-4">Back to the Store</Link>
        </p>
      )}
    </div>
  );
}
