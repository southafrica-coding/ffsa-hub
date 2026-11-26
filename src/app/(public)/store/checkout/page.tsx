import type { Metadata } from "next";
import { storePaymentsEnabled } from "@/lib/store/flags";
import { eftDetails } from "@/lib/store/emails";
import { storePayfastAllowed } from "@/lib/store/payments";
import { storeStripeAllowed } from "@/lib/store/stripe";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Cart" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  const card = storePayfastAllowed().ok;
  const eft = storePaymentsEnabled() && !!eftDetails();
  const stripe = storeStripeAllowed().ok;
  return (
    <div className="px-4 pt-8 md:px-8 md:pt-12">
      <div className="masthead-context">Cart</div>
      <h1 className="masthead-title">Checkout</h1>
      <CheckoutForm methods={{ card, eft, stripe }} cancelled={!!cancelled} />
    </div>
  );
}
