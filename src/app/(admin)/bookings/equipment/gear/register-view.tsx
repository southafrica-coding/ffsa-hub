"use client";

// Register, interactive half. Desktop is frame 45b drawn dark: category tabs,
// a product table, a product opens to its units. Phone is frame 47e-1:
// two-line rows, filter chips, 44px+ targets. A unit opens /gear/[tag].
// Filtering and search live in lib/equipment/register.ts (filterRegister).

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EquipmentLiveStatus } from "@/services/equipment";
import { LIVE_STATUS_LABEL, filterRegister } from "@/lib/equipment/register";

export type RegisterUnit = {
  tag: string;
  label: string | null;
  serial: string;
  serialMissing: boolean;
  condition: string;
  conditionTone: "bad" | "fault" | "plain" | "none";
  status: EquipmentLiveStatus;
  checked: string;
  checkedMissing: boolean;
  /** The sheet's "Assigned to", verbatim. */
  ownerLabel: string | null;
  locationId: string | null;
  location: string | null;
  /** An import nobody has checked on the shelf yet (isUnverifiedImport). */
  unverified: boolean;
};

export type RegisterLocation = { key: string; label: string; n: number };

export type RegisterProduct = {
  id: string;
  name: string;
  make: string;
  category: string;
  total: number;
  bookable: number;
  out: number;
  attention: string;
  needsAttention: boolean;
  checked: string;
  checkedIncomplete: boolean;
  listed: boolean;
  /** How it's tracked (381). Counted and consumable items have no units. */
  tracking: "tagged" | "counted" | "consumable";
  counted: { locationId: string | null; location: string | null } | null;
  /** On the borrow form. */
  requestable: boolean;
  units: RegisterUnit[];
};

type PhoneFilter = "all" | "attention" | "out";

// The name track cannot be minmax(0, 1fr). Beside the admin shell and the
// hire panel, the other tracks already fill a 1280px viewport, so a 0
// minimum collapses the product column to 0px. The name, the category
// label, and the first quantity then paint from the same x — "AUXILIARY"
// lands on "Printer", and a long name runs through the units figure.
// 140px keeps a short name intact; longer names wrap inside the cell.
const COLS =
  "md:grid-cols-[28px_minmax(140px,1.6fr)_minmax(96px,100px)_52px_64px_minmax(152px,1fr)_minmax(108px,116px)]";
const UNIT_COLS = "md:grid-cols-[110px_64px_minmax(0,1fr)_190px_180px_120px_130px]";

export function StatusPill({ status }: { status: EquipmentLiveStatus }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-[4px] px-1.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.14em]",
        status === "available" && "text-[color:var(--hire-ok)] ring-1 ring-inset ring-[color:var(--hire-line-strong)]",
        status === "maintenance" && "bg-[color:var(--hire-ink)] text-[color:var(--hire-bg)]",
        status === "out" && "bg-[color:var(--hire-surface2)] text-[color:var(--hire-ink)] ring-1 ring-inset ring-[color:var(--hire-ink)]",
        status === "reserved" && "text-[color:var(--hire-body)] ring-1 ring-inset ring-[color:var(--hire-line-strong)]",
        status === "retired" && "text-[color:var(--hire-dim)] line-through"
      )}
    >
      {LIVE_STATUS_LABEL[status]}
    </span>
  );
}

/** On units imported from the first Sortly inventory that nobody has found on the shelf yet. */
export function UnverifiedBadge() {
  return (
    <span
      title="Imported from the first Sortly inventory. Check it exists, then edit or retire it."
      className="inline-block whitespace-nowrap rounded-[4px] px-1.5 py-[2px] align-middle font-sans text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--hire-accent)] ring-1 ring-inset ring-[color:var(--hire-accent)]"
    >
      Unverified
    </span>
  );
}

export function RegisterView({
  context,
  products,
  unitTotal,
  maintenanceTotal,
  locations,
  initialOpenId,
  canAdd,
}: {
  context: string;
  products: RegisterProduct[];
  unitTotal: number;
  maintenanceTotal: number;
  /** Locations that hold gear, for the location filter. */
  locations: RegisterLocation[];
  /** ?open=<product id>, so the unit page's back link lands on its product. */
  initialOpenId: string | null;
  /** The inventory manager sees Add item. */
  canAdd: boolean;
}) {
  const [category, setCategory] = useState("all");
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>("all");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("all");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + p.total);
    return [
      { key: "all", label: "All", n: unitTotal },
      ...[...counts.entries()].map(([key, n]) => ({ key, label: key, n })),
    ];
  }, [products, unitTotal]);

  // Search covers product name, brand and model, and every unit's tag,
  // serial, label, owner and location. A product found through its units
  // opens to show them.
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => filterRegister(products, { category, location, query: q }),
    [products, category, location, q]
  );

  const phoneVisible = visible.filter(
    ({ product }) =>
      phoneFilter === "all" ||
      (phoneFilter === "attention" && product.needsAttention) ||
      (phoneFilter === "out" && product.out > 0)
  );

  const productCount = products.length;

  return (
    <div className="pb-6">
      {/* ── Masthead ── */}
      <header className="flex flex-col gap-3 border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-3 md:flex-row md:items-end md:justify-between md:gap-6 md:px-9 md:pb-5 md:pt-7">
        <div className="min-w-0">
          <div className="mb-2 hidden items-center gap-2.5 md:flex">
            <span className="h-[3px] w-4 bg-[color:var(--hire-accent)]" />
            <span className="hire-label truncate">{context}</span>
          </div>
          <div className="flex items-end justify-between gap-3">
            <h1 className="hire-display text-[52px] md:text-[72px]">
              <span className="md:hidden">Gear</span>
              <span className="hidden md:inline">Register</span>
            </h1>
            <span className="flex items-center gap-3 pb-1.5 text-[13px] md:hidden">
              {productCount} items
              {canAdd && <AddItemLink />}
            </span>
          </div>
        </div>
        <div className="hidden items-end gap-8 md:flex">
          <div>
            <div className="hire-display text-[44px]">{unitTotal}</div>
            <div className="hire-label mt-1">Units</div>
          </div>
          <div>
            <div className="hire-display text-[44px]">{productCount}</div>
            <div className="hire-label mt-1">Items</div>
          </div>
          <div>
            <div className={cn("hire-display text-[44px]", maintenanceTotal > 0 && "!text-[color:var(--hire-accent)]")}>
              {maintenanceTotal}
            </div>
            <div className="hire-label mt-1">In maintenance</div>
          </div>
          {canAdd && (
            <div className="pb-1.5">
              <AddItemLink />
            </div>
          )}
        </div>

        {/* Phone: search + chips live in the header (47e-1). */}
        <div className="flex flex-col gap-2.5 md:hidden">
          <SearchBox value={query} onChange={setQuery} placeholder="Tag, serial, brand…" />
          <div className="-mx-[18px] flex gap-2 overflow-x-auto px-[18px]">
            {(
              [
                ["all", "All"],
                ["attention", "Needs attention"],
                ["out", "Out"],
              ] as [PhoneFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPhoneFilter(key)}
                className={cn(
                  "flex h-11 shrink-0 items-center rounded-[999px] px-4 text-[13px]",
                  phoneFilter === key
                    ? "bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
                    : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {locations.length > 1 && <LocationSelect value={location} onChange={setLocation} locations={locations} />}
        </div>
      </header>

      {/* ── Desktop toolbar: category tabs + search ── */}
      <div className="hidden items-center gap-2 border-b border-[color:var(--hire-line)] px-9 py-3.5 md:flex">
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-[999px] px-4 text-[12px] font-bold uppercase tracking-[0.12em]",
              category === c.key
                ? "bg-[color:var(--hire-accent)] text-[color:var(--hire-on-accent)]"
                : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)] hover:bg-[color:var(--hire-hover)]"
            )}
          >
            {c.label}
            <span className="font-normal opacity-70">{c.n}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {locations.length > 1 && <LocationSelect value={location} onChange={setLocation} locations={locations} />}
          <div className="w-[320px]">
            <SearchBox value={query} onChange={setQuery} placeholder="Tag, serial, brand, model or owner" />
          </div>
        </div>
      </div>

      {/* ── Desktop table head + rows. min-width keeps the tracks from
          collapsing when the shell is open; overflow scrolls rather than
          letting a cell paint into its neighbour. ── */}
      <div className="md:overflow-x-auto">
      <div className="md:min-w-[780px]">
      <div
        className={cn(
          "hidden gap-3 bg-[color:var(--hire-surface)] py-2.5 pl-6 pr-9 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--hire-muted)] md:grid",
          COLS
        )}
      >
        <span />
        <span className="min-w-0 overflow-hidden">Product</span>
        <span className="min-w-0 overflow-hidden">Category</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Free</span>
        <span className="min-w-0 overflow-hidden">Needs attention</span>
        <span className="min-w-0 overflow-hidden">Last checked</span>
      </div>

      {/* ── Rows (desktop table rows, phone two-line rows) ── */}
      {(visible.length === 0 || phoneVisible.length === 0) && (
        <p
          className={cn(
            "px-[18px] py-8 text-[14px] text-[color:var(--hire-muted)] md:px-9",
            visible.length > 0 && "md:hidden"
          )}
        >
          {q
            ? `Nothing matches “${query.trim()}”.`
            : products.length === 0
              ? "The register is empty."
              : location !== "all"
                ? "No gear at this location in this category."
                : "Nothing here right now."}
        </p>
      )}
      <ul>
        {visible.map(({ product: p, units, viaUnits }) => {
          const open = openId === p.id || (viaUnits && !!q);
          const hiddenOnPhone = !phoneVisible.some((v) => v.product.id === p.id);
          return (
            <li key={p.id} className={cn("border-b border-[color:var(--hire-line)]", hiddenOnPhone && "hidden md:block")}>
              <button
                type="button"
                onClick={() => setOpenId(open && !viaUnits ? null : p.id)}
                aria-expanded={open}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2.5 text-left normal-case tracking-normal md:py-3 md:pl-6 md:pr-9",
                  COLS,
                  open ? "bg-[color:var(--hire-surface)]" : "hover:bg-[color:var(--hire-surface)]",
                  "min-h-[56px] md:min-h-0"
                )}
              >
                <span className="hidden text-center text-[15px] font-bold text-[color:var(--hire-ink)] md:block">
                  {open ? "−" : "+"}
                </span>
                {/* Name and make stay in normal flow. Inline + truncate does
                    not clip, so a 0-wide cell painted the full string over
                    the category and the units figure, and the ellipsis left
                    a second, offset copy of the name. */}
                <span className="flex min-w-0 flex-col gap-0.5 overflow-hidden md:flex-row md:flex-wrap md:items-baseline md:gap-x-2">
                  <span
                    className="min-w-0 max-w-full break-words text-[15px] leading-snug text-[color:var(--hire-ink)] md:text-[14px] md:font-bold"
                    title={p.name}
                  >
                    {p.name}
                  </span>
                  <span
                    className="min-w-0 max-w-full break-words text-[12px] leading-snug text-[color:var(--hire-muted)] md:text-[13px]"
                    title={p.make}
                  >
                    {p.make}
                  </span>
                </span>
                {/* Phone: bookable/total and what needs attention, on the right. */}
                <span className="shrink-0 whitespace-nowrap text-right tabular-nums md:hidden">
                  <span className="hire-display block text-[24px] leading-none">
                    {p.tracking === "consumable" ? p.total : `${p.bookable}/${p.total}`}
                  </span>
                  <span
                    className={cn(
                      "block max-w-[150px] truncate text-[11px]",
                      p.attention ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-dim)]"
                    )}
                    title={p.attention || undefined}
                  >
                    {p.attention || "—"}
                  </span>
                </span>
                <span className="hidden min-w-0 overflow-hidden break-words text-[11px] uppercase leading-tight tracking-[0.12em] text-[color:var(--hire-muted)] md:block">
                  {p.category}
                </span>
                <span className="hire-display hidden text-right text-[22px] tabular-nums md:block">{p.total}</span>
                <span
                  className={cn(
                    "hire-display hidden text-right text-[22px] tabular-nums md:block",
                    p.bookable < p.total && p.tracking !== "consumable" && "!text-[color:var(--hire-accent)]"
                  )}
                >
                  {p.tracking === "consumable" ? "—" : p.bookable}
                </span>
                <span
                  className={cn(
                    "hidden min-w-0 overflow-hidden break-words text-[13px] leading-snug md:block",
                    p.attention ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-dim)]"
                  )}
                  title={p.attention || undefined}
                >
                  {p.attention || "—"}
                </span>
                <span
                  className={cn(
                    "hidden min-w-0 overflow-hidden break-words text-[13px] leading-snug md:block",
                    p.checkedIncomplete ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-body)]"
                  )}
                >
                  {p.checked}
                </span>
              </button>

              {open && (p.counted ? <CountedSummary product={p} /> : <UnitList product={p} units={units} />)}
            </li>
          );
        })}
      </ul>
      </div>
      </div>
    </div>
  );
}

function AddItemLink() {
  return (
    <Link
      href="/bookings/equipment/gear/new"
      className="flex h-11 items-center gap-1.5 rounded-[8px] bg-[color:var(--hire-accent)] px-4 text-[14px] font-bold !text-[color:var(--hire-on-accent)] md:h-10"
    >
      <Plus className="h-4 w-4" /> Add item
    </Link>
  );
}

/** A counted or consumable item, opened: what it is and where, and a link to its page. */
function CountedSummary({ product }: { product: RegisterProduct }) {
  const consumable = product.tracking === "consumable";
  return (
    <div className="bg-[color:var(--hire-surface)] md:px-9 md:pb-4 md:pl-[52px]">
      <Link
        href={`/bookings/equipment/gear/products/${product.id}`}
        className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[color:var(--hire-line)] py-2 pl-8 pr-[18px] text-[13px] hover:!text-[color:var(--hire-ink)] md:border md:border-[color:var(--hire-line2)] md:bg-[color:var(--hire-bg)] md:px-3.5"
      >
        <span className="min-w-0">
          <span className="text-[color:var(--hire-ink)]">{consumable ? "Consumable" : "Counted"}</span>
          {" · "}
          {product.counted?.location ?? "No location"}
          {!consumable && (
            <>
              {" · "}
              {product.out > 0 ? `${product.out} booked or out today` : "all in"}
              {" · "}
              <span className={product.requestable ? "text-[color:var(--hire-ok)]" : "text-[color:var(--hire-muted)]"}>
                {product.requestable ? "can be borrowed" : "not on the borrow form"}
              </span>
            </>
          )}
        </span>
        <span className="text-[color:var(--hire-accent)]">{consumable ? "Stock ›" : "Stock & listing ›"}</span>
      </Link>
    </div>
  );
}

function UnitList({ product, units }: { product: RegisterProduct; units: RegisterUnit[] }) {
  return (
    <div className="bg-[color:var(--hire-surface)] md:px-9 md:pb-4 md:pl-[52px]">
      <Link
        href={`/bookings/equipment/gear/products/${product.id}`}
        className="flex min-h-[48px] items-center justify-between gap-3 border-t border-[color:var(--hire-line)] pl-8 pr-[18px] text-[13px] hover:!text-[color:var(--hire-ink)] md:min-h-0 md:border-t-0 md:px-0 md:pb-2.5"
      >
        <span>
          Store:{" "}
          <span className={product.listed ? "text-[color:var(--hire-ok)]" : "text-[color:var(--hire-muted)]"}>
            {product.listed ? "listed" : "not listed"}
          </span>
        </span>
        <span className="text-[color:var(--hire-accent)]">Edit listing ›</span>
      </Link>
      <div className="md:border md:border-[color:var(--hire-line2)] md:bg-[color:var(--hire-bg)]">
        <div
          className={cn(
            "hidden gap-3 border-b border-[color:var(--hire-line-strong)] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--hire-muted)] md:grid",
            UNIT_COLS
          )}
        >
          <span>Tag</span>
          <span>Label</span>
          <span>Serial</span>
          <span>Assigned to</span>
          <span>Condition</span>
          <span>Status</span>
          <span>Checked</span>
        </div>
        {units.map((u) => (
          <Link
            key={u.tag}
            href={`/bookings/equipment/gear/${encodeURIComponent(u.tag)}`}
            className={cn(
              "grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-[color:var(--hire-line)] py-2 pl-8 pr-[18px] first:border-t-0 hover:bg-[color:var(--hire-hover)] md:min-h-0 md:border-t-0 md:border-b md:border-[color:var(--hire-line)] md:px-3.5",
              UNIT_COLS
            )}
          >
            {/* Phone: tag + label on top, serial · condition under it, status on the right. */}
            <span className="min-w-0 md:contents">
              <span className="hire-mono text-[13px] font-bold text-[color:var(--hire-ink)] md:text-[12px]">
                {u.tag}
                {u.label && <span className="ml-2 font-normal text-[color:var(--hire-muted)] md:hidden">{u.label}</span>}
                {u.unverified && (
                  <span className="ml-2">
                    <UnverifiedBadge />
                  </span>
                )}
              </span>
              <span className="hire-mono hidden text-[11px] text-[color:var(--hire-muted)] md:inline">{u.label}</span>
              <span
                className={cn(
                  "hire-mono block truncate text-[12px] md:inline",
                  u.serialMissing ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-body)]"
                )}
              >
                {u.serial}
                <span className="font-sans text-[color:var(--hire-muted)] md:hidden">
                  {" "}
                  · {u.condition}
                  {u.ownerLabel && <> · {u.ownerLabel}</>}
                </span>
              </span>
              <span className="hidden min-w-0 text-[12px] leading-tight md:block">
                <span className="block truncate text-[color:var(--hire-body)]">{u.ownerLabel ?? "—"}</span>
                <span className="block truncate text-[11px] text-[color:var(--hire-muted)]">{u.location ?? "No location"}</span>
              </span>
              <span
                className={cn(
                  "hidden text-[13px] md:inline",
                  u.conditionTone === "bad" && "font-bold text-[color:var(--hire-ink)]",
                  u.conditionTone === "fault" && "text-[color:var(--hire-accent)]",
                  u.conditionTone === "plain" && "text-[color:var(--hire-body)]",
                  u.conditionTone === "none" && "text-[color:var(--hire-dim)]"
                )}
              >
                {u.condition}
              </span>
            </span>
            <span>
              <StatusPill status={u.status} />
            </span>
            <span
              className={cn(
                "hidden text-[13px] md:inline",
                u.checkedMissing ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-body)]"
              )}
            >
              {u.checked}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function LocationSelect({
  value,
  onChange,
  locations,
}: {
  value: string;
  onChange: (v: string) => void;
  locations: RegisterLocation[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Location"
      className="h-11 rounded-[8px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface2)] px-3 text-[16px] text-[color:var(--hire-ink)] md:h-9 md:rounded-[6px] md:text-[13px]"
    >
      <option value="all">All locations</option>
      {locations.map((l) => (
        <option key={l.key} value={l.key}>
          {l.label} · {l.n}
        </option>
      ))}
    </select>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="text-[16px] md:text-[13px]">
      <label className="flex h-11 items-center gap-2.5 rounded-[8px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface2)] px-3.5 md:h-9 md:rounded-[6px]">
        <Search className="h-[15px] w-[15px] shrink-0 text-[color:var(--hire-muted)]" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="hire-bare w-full min-w-0 outline-none"
        />
      </label>
    </div>
  );
}
