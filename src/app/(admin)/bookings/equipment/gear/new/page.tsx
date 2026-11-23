// Add item (stage O): how anything FFSA buys gets into the register.
// Inventory manager only. After saving, the item's own page takes photos,
// prices and the store listing.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEquipmentAccess, listLocations, listProducts } from "@/services/equipment";
import { NewItemForm } from "./new-item-form";

export default async function NewItemPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) redirect("/bookings/equipment/gear");

  const [locationsRes, productsRes] = await Promise.all([listLocations(supabase), listProducts(supabase)]);
  const locations = ((locationsRes.data ?? []) as { id: string; name: string }[]).map((l) => ({ id: l.id, name: l.name }));
  const categories = [
    ...new Set(((productsRes.data ?? []) as { register_category: string }[]).map((p) => p.register_category)),
  ].sort();

  return (
    <div className="pb-10">
      <header className="border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-3 md:px-9 md:pb-5 md:pt-6">
        <Link
          href="/bookings/equipment/gear"
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] !text-[color:var(--hire-muted)] hover:!text-[color:var(--hire-ink)] md:min-h-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Register
        </Link>
        <h1 className="hire-display text-[44px] md:text-[64px]">Add item</h1>
        <p className="mt-1 max-w-xl text-[14px]">
          Something new we bought, or something we own that isn&apos;t in the register yet. Photos and prices come on the
          next page.
        </p>
      </header>
      <NewItemForm locations={locations} categories={categories} />
    </div>
  );
}
