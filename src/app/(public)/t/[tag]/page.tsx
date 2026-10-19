// /t/[tag] is where the QR code on every tag points (spec, Routes).
// Staff land on the unit in the register; everyone else on the product's
// store page, or the store itself if that product isn't listed.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTagProduct, hasEquipmentAccess } from "@/services/equipment";

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: raw } = await params;
  const tag = decodeURIComponent(raw).trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,32}$/.test(tag)) redirect("/hire");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && (await hasEquipmentAccess(supabase))) {
    redirect(`/bookings/equipment/gear/${encodeURIComponent(tag)}`);
  }

  // The public can't read units, so look the tag up with the service role and
  // hand back nothing but a listed product's slug.
  const product = await getTagProduct(createAdminClient(), tag);
  redirect(product?.is_listed ? `/hire/p/${product.slug}` : "/hire");
}
