import { redirect } from "next/navigation";
import { Masthead } from "@/components/ffsa";
import type { StoreProduct } from "@/lib/store/types";
import { listAllProducts } from "@/services/store";
import { storeAdminGuard } from "../../guard";
import { CouponForm } from "../coupon-form";

export default async function NewCouponPage() {
  const { supabase, canManage } = await storeAdminGuard();
  if (!canManage) redirect("/store/admin");
  const { data } = await listAllProducts(supabase);
  const products = ((data ?? []) as StoreProduct[]).filter((p) => p.status !== "archived").map((p) => ({ id: p.id, title: p.title }));
  return (
    <div className="ffsa-screen">
      <Masthead context="Store · Coupons" title="New coupon" />
      <CouponForm products={products} />
    </div>
  );
}
