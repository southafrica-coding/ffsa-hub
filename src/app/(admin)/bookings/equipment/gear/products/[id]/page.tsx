// The listing editor (frame 47e-4): how a product gets onto the storefront.
// Price and deposit, photos, what's included, specs, store category, and
// whether it may leave the building. One page on desktop, a stack on a phone.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getEquipmentAccess,
  getProductById,
  countedToday,
  listCategories,
  listLocations,
  listProductPhotos,
  listProducts,
  listStockMoves,
  listUnits,
  type EquipmentStockMove,
  type EquipmentCategory,
  type EquipmentProductPhoto,
  type EquipmentProductWithRefs,
  type EquipmentUnitState,
} from "@/services/equipment";
import { photoUrl } from "@/lib/equipment/photos";
import { sastToday } from "@/lib/equipment/dates";
import { shortDate } from "@/lib/equipment/register";
import { ListingEditor } from "./listing-editor";
import { ItemPanel } from "./item-panel";

export default async function ListingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: productData } = await getProductById(supabase, id);
  if (!productData) notFound();
  const product = productData as EquipmentProductWithRefs;

  const counted = product.tracking !== "tagged";
  const [unitsRes, photosRes, catsRes, access, locationsRes, productsRes, movesRes, today] = await Promise.all([
    listUnits(supabase, { productId: id }),
    listProductPhotos(supabase, [id]),
    listCategories(supabase),
    user ? getEquipmentAccess(supabase, user.id) : null,
    listLocations(supabase),
    listProducts(supabase),
    counted ? listStockMoves(supabase, id) : Promise.resolve({ data: [] }),
    counted ? countedToday(supabase, sastToday()) : Promise.resolve({ data: new Map<string, { stock: number; free: number }>() }),
  ]);
  const freeToday = today.data.get(id)?.free ?? null;
  const locations = ((locationsRes.data ?? []) as { id: string; name: string }[]).map((l) => ({ id: l.id, name: l.name }));
  const registerCategories = [
    ...new Set(((productsRes.data ?? []) as { register_category: string }[]).map((p) => p.register_category)),
  ].sort();
  const moves = ((movesRes.data ?? []) as EquipmentStockMove[]).map((m) => ({
    id: m.id,
    delta: m.delta,
    reason: m.reason,
    note: m.note,
    supplier: m.supplier,
    unitCostCents: m.unit_cost_cents,
    day: shortDate(m.happened_on),
    who: m.actor?.display_name ?? null,
    orderNumber: m.order?.number ?? null,
  }));

  const units = (unitsRes.data ?? []) as EquipmentUnitState[];
  const categories = (catsRes.data ?? []) as EquipmentCategory[];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const categoryOptions = categories
    .map((c) => ({
      id: c.id,
      label: c.parent_id && byId.get(c.parent_id) ? `${byId.get(c.parent_id)!.name} › ${c.name}` : c.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const make = [product.brand, product.model].filter(Boolean).join(" ");

  return (
    <div>
      <header className="border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-3 md:px-9 md:pb-5 md:pt-6">
        <Link
          href={`/bookings/equipment/gear?open=${product.id}`}
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] !text-[color:var(--hire-muted)] hover:!text-[color:var(--hire-ink)] md:min-h-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Register
        </Link>
        <div className="text-[13px] text-[color:var(--hire-muted)]">
          {make ? `${make} · ` : ""}
          {counted ? product.register_category : `${units.length} ${units.length === 1 ? "unit" : "units"}`}
        </div>
        <h1 className="hire-display mt-0.5 text-[44px] md:text-[64px]">{product.name}</h1>
      </header>
      <ItemPanel
        item={{
          id: product.id,
          name: product.name,
          brand: product.brand,
          model: product.model,
          category: product.register_category,
          tracking: product.tracking ?? "tagged",
          stock: product.stock_quantity ?? 0,
          free: freeToday,
          locationId: product.location_id ?? null,
          isRequestable: product.is_requestable ?? false,
          reorderAt: product.reorder_at ?? null,
          description: product.description,
        }}
        moves={moves}
        locations={locations}
        categories={registerCategories}
        canManage={!!access?.canManage}
        canOperate={!!access?.canOperate}
      />
      {product.tracking === "consumable" ? (
        <p className="px-[18px] py-5 text-[13px] text-[color:var(--hire-muted)] md:px-9">
          Consumables are handed out, not lent, so they don&apos;t go on the store or the borrow form.
        </p>
      ) : (
      <>
      <h2 className="hire-label border-b border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] px-[18px] py-2.5 font-bold md:px-9">
        {product.is_listed ? "On the store" : "Store listing"}
      </h2>
      <ListingEditor
        canEdit={!!access?.canManage}
        product={{
          id: product.id,
          slug: product.slug,
          is_listed: product.is_listed,
          can_leave_building: product.can_leave_building,
          price_day_cents: product.price_day_cents,
          price_weekend_cents: product.price_weekend_cents,
          price_week_cents: product.price_week_cents,
          deposit_cents: product.deposit_cents,
          internal_day_cents: product.internal_day_cents,
          description: product.description,
          included: product.included ?? [],
          specs: product.specs ?? {},
          store_category_id: product.store_category_id,
          // undefined until migration 285 is applied
          replacement_value_cents: product.replacement_value_cents ?? null,
          sortly_sid: product.sortly_sid ?? null,
        }}
        bookable={counted ? (freeToday ?? product.stock_quantity ?? 0) : units.filter((u) => u.status === "available").length}
        photos={((photosRes.data ?? []) as EquipmentProductPhoto[]).map((p) => ({
          id: p.id,
          url: photoUrl(p.file_path),
        }))}
        categories={categoryOptions}
      />
      </>
      )}
    </div>
  );
}
