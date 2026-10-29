// The asset register (frames 45b, 47e-1): one row per product, opened to show
// every unit under it. Read-only for now — editing comes with the listing
// editor and the warehouse flow.

import { createClient } from "@/lib/supabase/server";
import {
  listProducts,
  listUnits,
  listLocations,
  listMinistries,
  type EquipmentProductWithRefs,
  type EquipmentUnitState,
} from "@/services/equipment";
import {
  attentionText,
  checkedText,
  hasFault,
  hasNoSerial,
  needsAttention,
  shortDate,
  summariseUnits,
} from "@/lib/equipment/register";
import { RegisterView, type RegisterProduct } from "./register-view";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const supabase = await createClient();

  const [productsRes, unitsRes, locationsRes] = await Promise.all([
    listProducts(supabase),
    listUnits(supabase),
    listLocations(supabase),
  ]);

  const loadError = productsRes.error || unitsRes.error;
  if (loadError) {
    return (
      <div className="px-5 py-10 md:px-9">
        <h1 className="hire-display text-[52px]">Register</h1>
        <p className="mt-3 max-w-xl text-[14px]">
          The register couldn&apos;t be loaded: {loadError.message}
        </p>
      </div>
    );
  }

  const products = (productsRes.data ?? []) as EquipmentProductWithRefs[];
  const units = (unitsRes.data ?? []) as EquipmentUnitState[];
  const locations = new Map(
    ((locationsRes.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name])
  );

  // Who owns the gear: a unit's own owner, else its product's.
  const productOwner = new Map(products.map((p) => [p.id, p.owner_ministry_id]));
  const ownerIds = [
    ...new Set(
      units.map((u) => u.owner_ministry_id ?? productOwner.get(u.product_id)).filter((x): x is string => !!x)
    ),
  ];
  const { data: ministries } = await listMinistries(supabase, ownerIds);

  const byProduct = new Map<string, EquipmentUnitState[]>();
  for (const u of units) {
    const list = byProduct.get(u.product_id) ?? [];
    list.push(u);
    byProduct.set(u.product_id, list);
  }

  const rows: RegisterProduct[] = products
    .filter((p) => (byProduct.get(p.id)?.length ?? 0) > 0)
    .map((p) => {
      const us = byProduct.get(p.id) ?? [];
      const s = summariseUnits(us);
      return {
        id: p.id,
        name: p.name,
        make: [p.brand, p.model].filter(Boolean).join(" · "),
        category: p.register_category,
        total: s.total,
        bookable: s.bookable,
        out: s.out,
        attention: attentionText(s),
        needsAttention: needsAttention(s),
        checked: checkedText(s),
        checkedIncomplete: s.never > 0,
        listed: p.is_listed,
        units: us.map((u) => ({
          tag: u.tag,
          label: u.label,
          serial: hasNoSerial(u) ? (u.serial?.trim() ? `“${u.serial.trim()}”` : "No serial") : u.serial!,
          serialMissing: hasNoSerial(u),
          condition: u.condition ?? "Not recorded",
          conditionTone: u.status === "maintenance" ? "bad" : hasFault(u) ? "fault" : u.condition ? "plain" : "none",
          status: u.live_status,
          checked: u.last_checked_on ? shortDate(u.last_checked_on) : "Never",
          checkedMissing: !u.last_checked_on,
        })),
      };
    });

  const where = [...new Set(units.map((u) => (u.location_id ? locations.get(u.location_id) : null)).filter(Boolean))];
  const context = ["Equipment", ...where, ...(ministries ?? []).map((m: { name: string }) => m.name)].join(" · ");

  return (
    <RegisterView
      context={context}
      products={rows}
      unitTotal={units.length}
      maintenanceTotal={units.filter((u) => u.status === "maintenance").length}
      initialOpenId={open ?? null}
    />
  );
}
