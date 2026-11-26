import { notFound, redirect } from "next/navigation";
import { Masthead } from "@/components/ffsa";
import type { StoreCoupon } from "@/lib/store/coupons";
import type { StoreProduct } from "@/lib/store/types";
import { getCoupon, listAllProducts } from "@/services/store";
import { storeAdminGuard } from "../../guard";
import { CouponForm } from "../coupon-form";

export const dynamic = "force-dynamic";

export default async function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, canManage } = await storeAdminGuard();
  if (!canManage) redirect("/store/admin");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: row }, { data: productRows }] = await Promise.all([getCoupon(supabase, id), listAllProducts(supabase)]);
  const coupon = row as StoreCoupon | null;
  if (!coupon) notFound();
  // Keep the code's own product in the list even if it's archived now.
  const products = ((productRows ?? []) as StoreProduct[])
    .filter((p) => p.status !== "archived" || p.id === coupon.product_id)
    .map((p) => ({ id: p.id, title: p.title }));
  return (
    <div className="ffsa-screen">
      <Masthead context="Store · Coupons" title={coupon.code} />
      <CouponForm coupon={coupon} products={products} />
    </div>
  );
}
