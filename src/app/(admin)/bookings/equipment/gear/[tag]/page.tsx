// One unit (frames 45c, 47e-2): everything the sheet knew about it, its
// history from equipment_events, and the places a sheet can't fill
// (orders, repairs, the store) — empty until the unit is actually used.
// Staff who can operate equipment get a small Edit form (unit-edit-form.tsx);
// "Log a repair" comes with the warehouse stage.

import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import {
  countProductUnits,
  getEquipmentAccess,
  getProductById,
  getUnitByTag,
  listLocations,
  listMinistries,
  listOpenMaintenance,
  listUnitEvents,
  listUnitOrders,
  listUnitOwnerLabels,
  type EquipmentEvent,
  type EquipmentMaintenance,
  type EquipmentProductWithRefs,
  type EquipmentUnitState,
} from "@/services/equipment";
import { rands } from "@/lib/equipment/money";
import { centsToInput } from "@/lib/equipment/listing";
import {
  eventLabel,
  hasNoSerial,
  isUnverifiedImport,
  sastDate,
  shortDate,
  sourceText,
} from "@/lib/equipment/register";
import { HIRE } from "@/lib/equipment/hire-theme";
import { StatusPill, UnverifiedBadge } from "../register-view";
import { UnitEditForm } from "./unit-edit-form";

type UnitOrderRow = {
  id: string;
  handed_over_at: string | null;
  returned_at: string | null;
  order: { id: string; number: string; status: string; customer_name: string; starts_on: string; ends_on: string } | null;
};

export default async function UnitPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: unitData } = await getUnitByTag(supabase, tag);
  if (!unitData) notFound();
  const unit = unitData as EquipmentUnitState;

  const [productRes, eventsRes, maintRes, ordersRes, siblingsRes, locationsRes, ownerLabelRes, access] =
    await Promise.all([
      getProductById(supabase, unit.product_id),
      listUnitEvents(supabase, unit.id),
      listOpenMaintenance(supabase, unit.id),
      listUnitOrders(supabase, unit.id),
      countProductUnits(supabase, unit.product_id),
      listLocations(supabase),
      listUnitOwnerLabels(supabase, [unit.id]),
      user ? getEquipmentAccess(supabase, user.id) : null,
    ]);

  const product = productRes.data as EquipmentProductWithRefs | null;
  const events = (eventsRes.data ?? []) as EquipmentEvent[];
  const openRepairs = (maintRes.data ?? []) as EquipmentMaintenance[];
  const orders = ((ordersRes.data ?? []) as UnitOrderRow[]).filter((o) => o.order);
  const siblings = Math.max(0, (siblingsRes.count ?? 1) - 1);

  const ownerId = unit.owner_ministry_id ?? product?.owner_ministry_id ?? null;
  const { data: owners } = await listMinistries(supabase, ownerId ? [ownerId] : []);
  const ownerName = (owners as { name: string }[] | null)?.[0]?.name ?? null;
  const locationRows = (locationsRes.data ?? []) as { id: string; name: string }[];
  const locationName = locationRows.find((l) => l.id === unit.location_id)?.name ?? null;
  // Not in equipment_unit_state (285 came later); an error means 285 isn't applied yet.
  const ownerLabel =
    ((ownerLabelRes.error ? [] : ownerLabelRes.data ?? []) as { owner_label: string | null }[])[0]?.owner_label ?? null;
  const unverified = isUnverifiedImport(unit);
  const provenance = sourceText(unit.source);

  const make = [product?.brand, product?.model].filter(Boolean).join(" ") + (unit.label ? ` · ${unit.label}` : "");
  const noSerial = hasNoSerial(unit);
  const serialText = noSerial
    ? unit.serial?.trim()
      ? `“${unit.serial.trim()}” on the sheet`
      : "None recorded"
    : unit.serial!;

  // The one yellow band: a unit that can't be booked, and why.
  const repairReason = openRepairs[0]?.reason ?? unit.condition_note ?? unit.condition;
  const currentOrder = orders.find((o) => o.order?.id === unit.current_order_id)?.order ?? null;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.ffsahub.com").replace(/\/$/, "");
  const qrSvg = await QRCode.toString(`${siteUrl}/t/${encodeURIComponent(unit.tag)}`, {
    type: "svg",
    margin: 1,
    color: { dark: HIRE.bg, light: HIRE.ink },
  });

  const purchased =
    unit.purchase_date || unit.purchase_price_cents != null
      ? [unit.purchase_date && shortDate(unit.purchase_date), unit.purchase_price_cents != null && rands(unit.purchase_price_cents)]
          .filter(Boolean)
          .join(" · ")
      : null;

  const facts: { label: string; value: string | null; strong?: boolean; mono?: boolean; phone?: boolean }[] = [
    { label: "Serial", value: serialText, mono: true, phone: true },
    { label: "Category", value: product?.register_category ?? null },
    { label: "Condition", value: unit.condition ?? "Not recorded", strong: true, phone: true },
    { label: "Owned by", value: ownerName },
    { label: "Where it is", value: locationName, phone: true },
    { label: "Last checked", value: unit.last_checked_on ? shortDate(unit.last_checked_on) : "Never checked", phone: true },
    { label: "Supplier", value: unit.supplier },
    { label: "Purchased · price", value: purchased },
    { label: "Warranty", value: unit.warranty_until ? `Until ${shortDate(unit.warranty_until)}` : null },
    // Appended, not inserted: the phone grid's borders count children by position.
    { label: "Assigned to", value: ownerLabel },
    { label: "Came from", value: provenance },
  ];

  const onlyImport = events.every((e) => e.kind === "imported");

  const storefront = !product
    ? "—"
    : product.is_listed
      ? !product.can_leave_building
        ? `On the store as Not for hire (shown at ${rands(product.price_day_cents ?? 0)} a day).`
        : `Listed at ${rands(product.price_day_cents ?? 0)} a day.`
      : product.price_day_cents == null
        ? "Not listed. The product has no hire price."
        : !product.can_leave_building
          ? "Not listed. It isn't allowed to leave the building."
          : "Not listed yet.";

  return (
    <div className="pb-8">
      <header className="flex flex-col gap-3 border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-3 md:flex-row md:items-end md:justify-between md:gap-6 md:px-10 md:pb-6 md:pt-6">
        <div className="min-w-0">
          <Link
            href={product ? `/bookings/equipment/gear?open=${product.id}` : "/bookings/equipment/gear"}
            className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] text-[color:var(--hire-muted)] hover:text-[color:var(--hire-ink)] md:min-h-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Register
          </Link>
          <div className="mb-1 hidden items-center gap-2.5 md:flex">
            <span className="h-[3px] w-4 bg-[color:var(--hire-accent)]" />
            <span className="hire-label truncate">
              Register · {product?.name ?? "Unknown product"} · {make}
            </span>
          </div>
          <div className="text-[13px] text-[color:var(--hire-muted)] md:hidden">
            {product?.name ?? "Unknown product"} · {make}
          </div>
          <h1 className="hire-display mt-0.5 text-[60px] md:text-[88px]">{unit.tag}</h1>
          {unverified && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
              <UnverifiedBadge />
              <span>From the first Sortly inventory. Check it&apos;s on the shelf, then edit it or retire it.</span>
            </p>
          )}
        </div>
        <div className="hidden md:block">
          <span className="scale-125 inline-block origin-right">
            <StatusPill status={unit.live_status} />
          </span>
        </div>
      </header>

      {unit.status === "maintenance" && (
        <div className="bg-[color:var(--hire-accent)] px-[18px] py-3 text-[14px] leading-snug text-[color:var(--hire-on-accent)] md:px-10 md:text-[15px]">
          <b>In maintenance.</b>
          {repairReason && <> &ldquo;{repairReason}&rdquo;</>} It can&apos;t be booked until the repair is done and
          someone signs it back in.
        </div>
      )}

      <div className="grid md:grid-cols-[minmax(0,1fr)_400px]">
        <div className="md:border-r md:border-[color:var(--hire-line)] md:px-10 md:py-7">
          {/* Facts: 2×2 on a phone (47e-2), everything else on desktop (45c). */}
          <dl className="grid grid-cols-2 border-b border-[color:var(--hire-line)] md:grid-cols-3 md:border-b-0 md:border-t-2 md:border-t-[color:var(--hire-ink)]">
            {facts.map((f) => (
              <div
                key={f.label}
                className={cn(
                  "border-[color:var(--hire-line)] px-[18px] py-3 md:border-b md:px-0 md:pr-4",
                  !f.phone && "hidden md:block",
                  // Phone grid lines: a rule between the two columns and under the first row.
                  "max-md:[&:nth-child(1)]:border-b max-md:[&:nth-child(1)]:border-r max-md:[&:nth-child(3)]:border-b max-md:[&:nth-child(5)]:border-r"
                )}
              >
                <dt className="hire-label">{f.label}</dt>
                <dd
                  className={cn(
                    "mt-1 text-[14px] md:text-[15px]",
                    f.value ? "text-[color:var(--hire-ink)]" : "text-[color:var(--hire-accent)]",
                    f.strong && "font-bold",
                    f.mono && "hire-mono text-[13px] [overflow-wrap:anywhere]",
                    f.label === "Serial" && noSerial && "text-[color:var(--hire-accent)]"
                  )}
                >
                  {f.value ?? "Not recorded"}
                </dd>
              </div>
            ))}
          </dl>

          {access?.canOperate && (
            <UnitEditForm
              tag={unit.tag}
              locations={locationRows.map((l) => ({ id: l.id, name: l.name }))}
              initial={{
                label: unit.label ?? "",
                serial: unit.serial ?? "",
                condition: unit.condition ?? "",
                condition_note: unit.condition_note ?? "",
                supplier: unit.supplier ?? "",
                purchase_date: unit.purchase_date ?? "",
                purchase_price: centsToInput(unit.purchase_price_cents),
                warranty_until: unit.warranty_until ?? "",
                last_checked_on: unit.last_checked_on ?? "",
                location_id: unit.location_id ?? "",
                owner_label: ownerLabel ?? "",
                status: unit.status,
              }}
            />
          )}

          <section className="md:mt-7">
            <h2 className="hire-label px-[18px] pb-1 pt-4 md:bg-[color:var(--hire-surface)] md:px-4 md:py-2.5 md:font-bold md:!text-[color:var(--hire-ink)]">
              History
            </h2>
            {events.length === 0 && (
              <p className="px-[18px] py-3 text-[13px] text-[color:var(--hire-muted)] md:px-4">Nothing recorded yet.</p>
            )}
            <ul>
              {events.map((e) => (
                <li
                  key={e.id}
                  className="border-b border-[color:var(--hire-line)] px-[18px] py-2.5 md:grid md:grid-cols-[120px_14px_minmax(0,1fr)] md:items-baseline md:gap-3.5 md:px-4 md:py-3.5"
                >
                  <span className="hidden text-[12px] text-[color:var(--hire-muted)] md:inline">{sastDate(e.at)}</span>
                  <span
                    className={cn(
                      "hidden h-[9px] w-[9px] md:inline-block",
                      ["damaged", "missing", "repair_opened"].includes(e.kind)
                        ? "bg-[color:var(--hire-accent)]"
                        : "bg-[color:var(--hire-ink)]"
                    )}
                  />
                  <span className="block">
                    <span className="flex justify-between gap-3 text-[14px] text-[color:var(--hire-ink)] md:font-bold">
                      {eventLabel(e.kind)}
                      <span className="text-[12px] font-normal text-[color:var(--hire-muted)] md:hidden">
                        {sastDate(e.at)}
                      </span>
                    </span>
                    {e.detail && (
                      <span className="mt-0.5 block text-[12px] leading-[1.45] md:text-[13px]">{e.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {onlyImport && (
              <p className="px-[18px] py-3.5 text-[13px] text-[color:var(--hire-muted)] md:px-4">
                No bookings, check-outs or repairs yet. They appear here as they happen.
              </p>
            )}
          </section>
        </div>

        <aside className="hidden flex-col bg-[color:var(--hire-surface)] md:flex">
          <div className="flex items-center gap-5 border-b border-[color:var(--hire-line)] px-7 py-6">
            <div
              className="h-24 w-24 shrink-0 overflow-hidden rounded-[4px] [&>svg]:h-full [&>svg]:w-full"
              aria-label={`QR code for ${unit.tag}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <div>
              <div className="hire-label">Tag</div>
              <div className="hire-display text-[30px]">{unit.tag}</div>
              <div
                className={cn(
                  "text-[13px]",
                  unit.tag_printed_at ? "text-[color:var(--hire-body)]" : "text-[color:var(--hire-accent)]"
                )}
              >
                {unit.tag_printed_at ? `Printed ${sastDate(unit.tag_printed_at)}` : "Not printed yet"}
              </div>
            </div>
          </div>
          <SideBlock title="Use and earnings">
            {orders.length === 0 ? (
              <span className="text-[color:var(--hire-muted)]">Nothing to measure until it has been booked.</span>
            ) : (
              <>
                On {orders.length} {orders.length === 1 ? "order" : "orders"} so far.
                {currentOrder && (
                  <span className="mt-1 block">
                    Now on <b className="text-[color:var(--hire-ink)]">{currentOrder.number}</b> for{" "}
                    {currentOrder.customer_name}, {shortDate(currentOrder.starts_on)} – {shortDate(currentOrder.ends_on)}.
                  </span>
                )}
              </>
            )}
          </SideBlock>
          <SideBlock title="Storefront">
            {storefront}
            {product && (
              <Link
                href={`/bookings/equipment/gear/products/${product.id}`}
                className="mt-1.5 block text-[color:var(--hire-accent)] underline-offset-4 hover:underline"
              >
                Edit listing ›
              </Link>
            )}
          </SideBlock>
          <SideBlock title="Same product" last>
            {product ? (
              <Link
                href={`/bookings/equipment/gear?open=${product.id}`}
                className="underline decoration-[color:var(--hire-line-strong)] underline-offset-4 hover:decoration-[color:var(--hire-ink)]"
              >
                {siblings} other {[product.brand, product.model].filter(Boolean).join(" ") || product.name}{" "}
                {siblings === 1 ? "unit" : "units"}
              </Link>
            ) : (
              "—"
            )}
          </SideBlock>
        </aside>
      </div>
    </div>
  );
}

function SideBlock({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("px-7 py-5 text-[14px]", !last && "border-b border-[color:var(--hire-line)]")}>
      <div className="hire-label mb-2.5">{title}</div>
      {children}
    </div>
  );
}
