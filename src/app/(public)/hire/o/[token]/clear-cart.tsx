"use client";

import { useEffect } from "react";
import { writeCart } from "@/lib/equipment/use-cart";

// Back from PayFast with ?paid=1: the cart has become this order, so empty it.
export function ClearCartOnPaid() {
  useEffect(() => writeCart(null), []);
  return null;
}
