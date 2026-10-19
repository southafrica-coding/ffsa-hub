"use client";

// Register, interactive half. Desktop is frame 45b drawn dark: category tabs,
// a product table, a product opens to its units. Phone is frame 47e-1:
// two-line rows, filter chips, 44px+ targets. A unit opens /gear/[tag].

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EquipmentLiveStatus } from "@/services/equipment";
import { LIVE_STATUS_LABEL } from "@/lib/equipment/register";

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
};

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
  units: RegisterUnit[];
};

type PhoneFilter = "all" | "attention" | "out";

const COLS = "md:grid-cols-[28px_minmax(0,1fr)_110px_64px_84px_220px_190px]";
const UNIT_COLS = "md:grid-cols-[96px_64px_minmax(0,1fr)_220px_120px_130px]";

export function StatusPill({ status }: { status: EquipmentLiveStatus }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded px-1.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.14em]",
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

function matches(q: string, ...fields: (string | null | undefined)[]) {
  return fields.some((f) => f && f.toLowerCase().includes(q));
}

export function RegisterView({
  context,
  products,
  unitTotal,
  maintenanceTotal,
  initialOpenId,
}: {
  context: string;
  products: RegisterProduct[];
  unitTotal: number;
  maintenanceTotal: number;
  /** ?open=<product id>, so the unit page's back link lands on its product. */
  initialOpenId: string | null;
}) {
  const [category, setCategory] = useState("all");
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>("all");
  const [query, setQuery] = useState("");
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
  // serial and label. A product found through its units opens to show them.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return products
      .filter((p) => category === "all" || p.category === category)
      .map((p) => {
        if (!q) return { product: p, units: p.units, viaUnits: false };
        if (matches(q, p.name, p.make, p.category)) return { product: p, units: p.units, viaUnits: false };
        const us = p.units.filter((u) => matches(q, u.tag, u.serial, u.label));
        return us.length ? { product: p, units: us, viaUnits: true } : null;
      })
      .filter((x): x is { product: RegisterProduct; units: RegisterUnit[]; viaUnits: boolean } => !!x);
  }, [products, category, q]);

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
            <span className="pb-1.5 text-[13px] md:hidden">
              {unitTotal} units · {productCount} products
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
            <div className="hire-label mt-1">Products</div>
          </div>
          <div>
            <div className={cn("hire-display text-[44px]", maintenanceTotal > 0 && "!text-[color:var(--hire-accent)]")}>
              {maintenanceTotal}
            </div>
            <div className="hire-label mt-1">In maintenance</div>
          </div>
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
                  "flex h-11 shrink-0 items-center rounded-full px-4 text-[13px]",
                  phoneFilter === key
                    ? "bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
                    : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
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
              "flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-bold uppercase tracking-[0.12em]",
              category === c.key
                ? "bg-[color:var(--hire-accent)] text-[color:var(--hire-on-accent)]"
                : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)] hover:bg-[color:var(--hire-hover)]"
            )}
          >
            {c.label}
            <span className="font-normal opacity-70">{c.n}</span>
          </button>
        ))}
        <div className="ml-auto w-[320px]">
          <SearchBox value={query} onChange={setQuery} placeholder="Tag, serial, brand or model" />
        </div>
      </div>

      {/* ── Desktop table head ── */}
      <div
        className={cn(
          "hidden gap-3 bg-[color:var(--hire-surface)] py-2.5 pl-6 pr-9 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--hire-muted)] md:grid",
          COLS
        )}
      >
        <span />
        <span>Product</span>
        <span>Category</span>
        <span>Units</span>
        <span>Bookable</span>
        <span>Needs attention</span>
        <span>Last checked</span>
      </div>

      {/* ── Rows (desktop table rows, phone two-line rows) ── */}
      {(visible.length === 0 || phoneVisible.length === 0) && (
        <p
          className={cn(
            "px-[18px] py-8 text-[14px] text-[color:var(--hire-muted)] md:px-9",
            visible.length > 0 && "md:hidden"
          )}
        >
          {q ? `Nothing matches “${query.trim()}”.` : products.length === 0 ? "The register is empty." : "Nothing here right now."}
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
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2.5 text-left md:items-baseline md:py-3 md:pl-6 md:pr-9",
                  COLS,
                  open ? "bg-[color:var(--hire-surface)]" : "hover:bg-[color:var(--hire-surface)]",
                  "min-h-[56px] md:min-h-0"
                )}
              >
                <span className="hidden text-center text-[15px] font-bold text-[color:var(--hire-ink)] md:inline">
                  {open ? "−" : "+"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-[color:var(--hire-ink)] md:inline md:text-[14px] md:font-bold">
                    {p.name}
                  </span>{" "}
                  <span className="block truncate text-[12px] text-[color:var(--hire-muted)] md:inline md:text-[13px]">
                    {p.make}
                  </span>
                </span>
                {/* Phone: bookable/total and what needs attention, on the right. */}
                <span className="text-right md:hidden">
                  <span className="hire-display block text-[24px] leading-none">
                    {p.bookable}/{p.total}
                  </span>
                  <span
                    className={cn(
                      "block max-w-[150px] truncate text-[11px]",
                      p.attention ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-dim)]"
                    )}
                  >
                    {p.attention || "—"}
                  </span>
                </span>
                <span className="hidden text-[11px] uppercase tracking-[0.12em] text-[color:var(--hire-muted)] md:inline">
                  {p.category}
                </span>
                <span className="hire-display hidden text-[22px] md:inline">{p.total}</span>
                <span
                  className={cn(
                    "hire-display hidden text-[22px] md:inline",
                    p.bookable < p.total && "!text-[color:var(--hire-accent)]"
                  )}
                >
                  {p.bookable}
                </span>
                <span
                  className={cn(
                    "hidden text-[13px] md:inline",
                    p.attention ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-dim)]"
                  )}
                >
                  {p.attention || "—"}
                </span>
                <span
                  className={cn(
                    "hidden text-[13px] md:inline",
                    p.checkedIncomplete ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-body)]"
                  )}
                >
                  {p.checked}
                </span>
              </button>

              {open && <UnitList product={p} units={units} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UnitList({ product, units }: { product: RegisterProduct; units: RegisterUnit[] }) {
  return (
    <div className="bg-[color:var(--hire-surface)] md:px-9 md:pb-4 md:pl-[52px]">
      <Link
        href={`/bookings/equipment/gear/products/${product.id}`}
        className="flex min-h-[48px] items-center justify-between gap-3 border-t border-[color:var(--hire-line)] pl-8 pr-[18px] text-[13px] hover:text-[color:var(--hire-ink)] md:min-h-0 md:border-t-0 md:px-0 md:pb-2.5"
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
              </span>
              <span className="hire-mono hidden text-[11px] text-[color:var(--hire-muted)] md:inline">{u.label}</span>
              <span
                className={cn(
                  "hire-mono block truncate text-[12px] md:inline",
                  u.serialMissing ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-body)]"
                )}
              >
                {u.serial}
                <span className="font-sans text-[color:var(--hire-muted)] md:hidden"> · {u.condition}</span>
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
    <label className="flex h-11 items-center gap-2.5 rounded-lg text-[16px] md:text-[13px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface2)] px-3.5 md:h-9 md:rounded-md">
      <Search className="h-[15px] w-[15px] shrink-0 text-[color:var(--hire-muted)]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="hire-bare w-full min-w-0 outline-none"
      />
    </label>
  );
}
