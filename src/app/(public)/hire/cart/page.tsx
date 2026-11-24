import type { Metadata } from "next";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Cart · Hire · Fire & Fragrance" };

// The cart lives in this browser (localStorage), so the page is all client.
export default function CartPage() {
  return <CartView />;
}
