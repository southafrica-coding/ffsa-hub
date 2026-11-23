// Borrow equipment (stage O): any signed-in user asks to borrow inventory
// for a school or a ministry — glasses for a DTS dinner, lanterns for a
// ministry night. Internal rate (usually free), no deposit, and the
// inventory manager approves every request, like a vehicle request.
// Personal hires go through the public store (/hire) at the public price.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, MastheadAction } from "@/components/ffsa";
import {
  listActiveMinistries,
  listActivePrograms,
  listBorrowableProducts,
  listLocations,
  listProductPhotos,
  listedAvailability,
  type EquipmentProductPhoto,
} from "@/services/equipment";
import { addDays, dayCount, isIsoDate, sastToday } from "@/lib/equipment/dates";
import { photoUrl } from "@/lib/equipment/photos";
import { BorrowForm, type BorrowItem } from "./borrow-form";

type Row = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  register_category: string;
  internal_day_cents: number;
  location_id: string | null;
  max_per_order: number | null;
};

export default async function BorrowPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const today = sastToday();
  const from = isIsoDate(sp.from) && sp.from >= today ? sp.from : addDays(today, 1);
  const to = isIsoDate(sp.to) && sp.to >= from && dayCount(from, sp.to) <= 90 ? sp.to : from;

  const [productsRes, avail, locationsRes, ministriesRes, programsRes, profileRes] = await Promise.all([
    listBorrowableProducts(supabase),
    listedAvailability(supabase, from, to),
    listLocations(supabase),
    listActiveMinistries(supabase),
    listActivePrograms(supabase),
    supabase.from("users").select("display_name,phone").eq("id", user.id).maybeSingle(),
  ]);
  const products = (productsRes.data ?? []) as Row[];
  const { data: photoRows } = await listProductPhotos(
    supabase,
    products.map((p) => p.id)
  );
  const photo = new Map<string, string>();
  for (const ph of (photoRows ?? []) as EquipmentProductPhoto[]) {
    if (!photo.has(ph.product_id)) photo.set(ph.product_id, photoUrl(ph.file_path));
  }
  const locations = new Map(((locationsRes.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));

  const items: BorrowItem[] = products
    .map((p) => {
      const a = avail.data.get(p.id);
      return {
        id: p.id,
        name: p.name,
        make: [p.brand, p.model].filter(Boolean).join(" "),
        description: p.description,
        category: p.register_category,
        stock: a?.stock ?? 0,
        free: a?.free ?? 0,
        max: p.max_per_order,
        internalDayCents: p.internal_day_cents,
        location: p.location_id ? (locations.get(p.location_id) ?? null) : null,
        photo: photo.get(p.id) ?? null,
      };
    })
    .filter((i) => i.stock > 0);

  const profile = profileRes.data as { display_name?: string | null; phone?: string | null } | null;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Bookings · Inventory"
        title="Borrow equipment"
        actions={<MastheadAction href="/hire/account">My requests</MastheadAction>}
      />
      <BorrowForm
        key={`${from}:${to}`}
        from={from}
        to={to}
        today={today}
        items={items}
        ministries={(ministriesRes.data ?? []) as { id: string; name: string }[]}
        schools={(programsRes.data ?? []) as { id: string; name: string }[]}
        defaultPhone={profile?.phone ?? ""}
      />
    </div>
  );
}
