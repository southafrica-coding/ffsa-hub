// The asset register (frames 45b, 47e-1): one row per product, opened to show
// every unit under it. Counted and consumable items (stage O, 381) are one
// row each with their count and where they're kept. The inventory manager
// adds items from here.

import { createClient } from "@/lib/supabase/server";
import {
  countedToday,
  getEquipmentAccess,
  listProducts,
  listUnits,
  listLocations,
  listMinistries,
  listUnitOwnerLabels,
  type EquipmentProductWithRefs,
  type EquipmentUnitState,
} from "@/services/equipment";
import {
  attentionText,
  checkedText,
  hasFault,
  hasNoSerial,
  isUnverifiedImport,
  needsAttention,
  NO_LOCATION,
  shortDate,
  summariseUnits,
} from "@/lib/equipment/register";
import { sastToday } from "@/lib/equipment/dates";
import { stockAttention } from "@/lib/equipment/inventory";
import { RegisterView, type RegisterProduct } from "./register-view";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [productsRes, unitsRes, locationsRes, ownerLabelsRes, countsRes, access] = await Promise.all([
    listProducts(supabase),
    listUnits(supabase),
    listLocations(supabase),
    listUnitOwnerLabels(supabase),
    countedToday(supabase, sastToday()),
    user ? getEquipmentAccess(supabase, user.id) : null,
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
  const locationRows = (locationsRes.data ?? []) as { id: string; name: string }[];
  const locations = new Map(locationRows.map((l) => [l.id, l.name]));
  // owner_label isn't in equipment_unit_state; an error here (285 not applied) just means none.
  const ownerLabels = new Map(
    ((ownerLabelsRes.error ? [] : ownerLabelsRes.data ?? []) as { id: string; owner_label: string | null }[]).map(
      (r) => [r.id, r.owner_label]
    )
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

  // Counted and consumable items: one row, no units. Before 381 every
  // product is tagged (tracking undefined), so this is empty.
  const countedRows: RegisterProduct[] = products
    .filter((p) => p.tracking === "counted" || p.tracking === "consumable")
    .map((p) => {
      const stock = p.stock_quantity ?? 0;
      const free = countsRes.data.get(p.id)?.free ?? stock;
      const location = p.location_id ? (locations.get(p.location_id) ?? null) : null;
      const attention = stockAttention({
        tracking: p.tracking,
        stock,
        reorderAt: p.reorder_at ?? null,
        description: p.description,
      });
      return {
        id: p.id,
        name: p.name,
        make: [p.brand, p.model].filter(Boolean).join(" · "),
        category: p.register_category,
        total: stock,
        bookable: free,
        out: stock - free,
        attention,
        needsAttention: !!attention,
        checked: "—",
        checkedIncomplete: false,
        listed: p.is_listed,
        tracking: p.tracking,
        counted: { locationId: p.location_id ?? null, location },
        requestable: p.is_requestable ?? false,
        units: [],
      };
    });

  const taggedRows: RegisterProduct[] = products
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
        tracking: "tagged" as const,
        counted: null,
        requestable: p.is_requestable ?? false,
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
          ownerLabel: ownerLabels.get(u.id) ?? null,
          locationId: u.location_id,
          location: u.location_id ? (locations.get(u.location_id) ?? null) : null,
          unverified: isUnverifiedImport(u),
        })),
      };
    });
  // Keep listProducts' order (category, sort order, name) across both kinds.
  const rowById = new Map([...taggedRows, ...countedRows].map((r) => [r.id, r]));
  const rows = products.map((p) => rowById.get(p.id)).filter((r): r is RegisterProduct => !!r);

  const where = [...new Set(units.map((u) => (u.location_id ? locations.get(u.location_id) : null)).filter(Boolean))];
  const context = ["Equipment", ...where, ...(ministries ?? []).map((m: { name: string }) => m.name)].join(" · ");

  // Location filter: every location that has gear, plus "No location" for the unverified imports.
  const locationOptions = locationRows
    .map((l) => ({
      key: l.id,
      label: l.name,
      n: units.filter((u) => u.location_id === l.id).length + countedRows.filter((r) => r.counted?.locationId === l.id).length,
    }))
    .filter((l) => l.n > 0);
  const unplaced = units.filter((u) => !u.location_id).length + countedRows.filter((r) => !r.counted?.locationId).length;
  if (unplaced > 0) locationOptions.push({ key: NO_LOCATION, label: "No location", n: unplaced });

  return (
    <RegisterView
      context={context}
      products={rows}
      unitTotal={units.length}
      maintenanceTotal={units.filter((u) => u.status === "maintenance").length}
      locations={locationOptions}
      initialOpenId={open ?? null}
      canAdd={!!access?.canManage}
    />
  );
}
