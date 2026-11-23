"use client";

// The inventory half of an item's page (stage O): its details, and for
// counted and consumable items the count, a form to record a change, and the
// history of every change. Rules: lib/equipment/inventory.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { rands } from "@/lib/equipment/money";
import {
  MOVE_LABEL,
  TRACKING_HELP,
  TRACKING_LABEL,
  moveReasonsFor,
  type MoveReason,
  type Tracking,
} from "@/lib/equipment/inventory";
import { BOX, Field, PRIMARY, SECONDARY } from "../../../inventory-ui";

export type ItemDetails = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string;
  tracking: Tracking;
  stock: number;
  free: number | null;
  locationId: string | null;
  isRequestable: boolean;
  reorderAt: number | null;
  description: string | null;
};

export type MoveView = {
  id: string;
  delta: number;
  reason: MoveReason;
  note: string | null;
  supplier: string | null;
  unitCostCents: number | null;
  day: string;
  who: string | null;
  orderNumber: string | null;
};

export function ItemPanel({
  item,
  moves,
  locations,
  categories,
  canManage,
  canOperate,
}: {
  item: ItemDetails;
  moves: MoveView[];
  locations: { id: string; name: string }[];
  categories: string[];
  canManage: boolean;
  canOperate: boolean;
}) {
  const counted = item.tracking !== "tagged";
  return (
    <div className="border-b border-[color:var(--hire-line)]">
      {counted && <StockBlock item={item} moves={moves} canManage={canManage} canOperate={canOperate} />}
      <DetailsBlock item={item} locations={locations} categories={categories} canManage={canManage} />
    </div>
  );
}

function StockBlock({
  item,
  moves,
  canManage,
  canOperate,
}: {
  item: ItemDetails;
  moves: MoveView[];
  canManage: boolean;
  canOperate: boolean;
}) {
  const router = useRouter();
  const reasons = moveReasonsFor(item.tracking, canManage);
  const [reason, setReason] = useState<MoveReason | null>(null);
  const [v, setV] = useState({ quantity: "", note: "", supplier: "", unitCost: "", happenedOn: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const low = item.tracking === "consumable" && item.reorderAt !== null && item.stock <= item.reorderAt;

  async function save() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/equipment/products/${item.id}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, ...v }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save that.");
      return;
    }
    setReason(null);
    setV({ quantity: "", note: "", supplier: "", unitCost: "", happenedOn: "" });
    router.refresh();
  }

  return (
    <section className="px-[18px] py-5 md:px-9">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
        <div>
          <div className={cn("hire-display text-[56px] leading-none tabular-nums", low && "!text-[color:var(--hire-accent)]")}>
            {item.stock}
          </div>
          <div className="hire-label mt-1.5">{item.tracking === "consumable" ? "In stock" : "We own"}</div>
        </div>
        {item.tracking === "counted" && item.free !== null && (
          <div>
            <div className="hire-display text-[56px] leading-none tabular-nums">{item.free}</div>
            <div className="hire-label mt-1.5">Free today</div>
          </div>
        )}
        <p className="max-w-sm pb-1 text-[13px] text-[color:var(--hire-muted)]">
          {TRACKING_LABEL[item.tracking]}. {TRACKING_HELP[item.tracking]}
          {low && <span className="block font-bold text-[color:var(--hire-accent)]">Time to reorder.</span>}
        </p>
      </div>

      {canOperate && reasons.length > 0 && (
        <div className="mt-5">
          <div className="hire-label mb-2">Record a change</div>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(reason === r ? null : r)}
                className={cn(
                  "flex h-11 items-center rounded-[999px] px-4 text-[13px]",
                  reason === r
                    ? "bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
                    : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)] hover:bg-[color:var(--hire-hover)]"
                )}
              >
                {MOVE_LABEL[r]}
              </button>
            ))}
          </div>

          {reason && (
            <div className="mt-3 grid max-w-3xl gap-3 md:grid-cols-2">
              <Field label={reason === "correction" ? "The right count" : "How many"}>
                <input
                  value={v.quantity}
                  onChange={(e) => setV({ ...v, quantity: e.target.value })}
                  inputMode="numeric"
                  autoFocus
                  className={cn(BOX, "h-11 tabular-nums")}
                />
              </Field>
              <Field label="When" hint="defaults to today">
                <input
                  type="date"
                  value={v.happenedOn}
                  onChange={(e) => setV({ ...v, happenedOn: e.target.value })}
                  className={cn(BOX, "h-11")}
                />
              </Field>
              {reason === "bought" && (
                <>
                  <Field label="Bought from" hint="optional">
                    <input value={v.supplier} onChange={(e) => setV({ ...v, supplier: e.target.value })} className={cn(BOX, "h-11")} />
                  </Field>
                  <Field label="Price each" hint="optional, rand">
                    <input
                      value={v.unitCost}
                      onChange={(e) => setV({ ...v, unitCost: e.target.value })}
                      inputMode="decimal"
                      className={cn(BOX, "h-11 tabular-nums")}
                    />
                  </Field>
                </>
              )}
              <Field
                label="Note"
                hint={["lost", "damaged", "correction"].includes(reason) ? "say what happened" : "optional"}
                className="md:col-span-2"
              >
                <input
                  value={v.note}
                  onChange={(e) => setV({ ...v, note: e.target.value })}
                  placeholder={reason === "handed_out" ? "Who it went to, what for" : ""}
                  className={cn(BOX, "h-11")}
                />
              </Field>
              {error && <p className="text-[14px] text-[color:var(--hire-accent)] md:col-span-2">{error}</p>}
              <div className="flex gap-2.5 md:col-span-2">
                <button type="button" onClick={save} disabled={busy} className={PRIMARY}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </button>
                <button type="button" onClick={() => setReason(null)} className={SECONDARY}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <div className="hire-label mb-1">History</div>
        {moves.length === 0 ? (
          <p className="text-[13px] text-[color:var(--hire-muted)]">No changes yet.</p>
        ) : (
          <ul>
            {moves.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-[color:var(--hire-line)] py-2.5 text-[13px]"
              >
                <span
                  className={cn(
                    "hire-display text-right text-[20px] tabular-nums",
                    m.delta < 0 ? "text-[color:var(--hire-muted)]" : "text-[color:var(--hire-ink)]"
                  )}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>
                <span className="min-w-0">
                  <span className="text-[color:var(--hire-ink)]">{MOVE_LABEL[m.reason]}</span>
                  {m.orderNumber && <span className="hire-mono ml-2 text-[12px]">{m.orderNumber}</span>}
                  {(m.note || m.supplier || m.unitCostCents !== null) && (
                    <span className="block break-words text-[color:var(--hire-muted)]">
                      {[m.note, m.supplier, m.unitCostCents !== null ? `${rands(m.unitCostCents)} each` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-right text-[12px] text-[color:var(--hire-muted)]">
                  {m.day}
                  {m.who && <span className="block">{m.who}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DetailsBlock({
  item,
  locations,
  categories,
  canManage,
}: {
  item: ItemDetails;
  locations: { id: string; name: string }[];
  categories: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    name: item.name,
    brand: item.brand ?? "",
    model: item.model ?? "",
    register_category: item.category,
    location_id: item.locationId ?? "",
    reorder_at: item.reorderAt === null ? "" : String(item.reorderAt),
    description: item.description ?? "",
  });
  const [requestable, setRequestable] = useState(item.isRequestable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locationName = locations.find((l) => l.id === item.locationId)?.name ?? "Not set";

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: v.name,
      brand: v.brand,
      model: v.model,
      register_category: v.register_category,
    };
    if (item.tracking !== "tagged") body.location_id = v.location_id || null;
    if (item.tracking !== "consumable") body.is_requestable = requestable;
    if (item.tracking === "consumable") {
      body.reorder_at = v.reorder_at.trim() === "" ? null : Number(v.reorder_at);
      body.description = v.description;
    }
    const res = await fetch(`/api/equipment/products/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <section className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[color:var(--hire-line)] px-[18px] py-3 text-[13px] md:px-9">
        <span>
          <span className="hire-label mr-2">Category</span>
          <span className="text-[color:var(--hire-ink)]">{item.category}</span>
        </span>
        {item.tracking !== "tagged" && (
          <span>
            <span className="hire-label mr-2">Kept in</span>
            <span className="text-[color:var(--hire-ink)]">{locationName}</span>
          </span>
        )}
        {item.tracking !== "consumable" && (
          <span>
            <span className="hire-label mr-2">Borrow form</span>
            <span className={item.isRequestable ? "text-[color:var(--hire-ok)]" : "text-[color:var(--hire-muted)]"}>
              {item.isRequestable ? "yes" : "no"}
            </span>
          </span>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto min-h-[44px] text-[13px] text-[color:var(--hire-accent)] md:min-h-0"
          >
            Edit details ›
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="border-t border-[color:var(--hire-line)] px-[18px] py-4 md:px-9">
      <div className="grid max-w-3xl gap-3 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2">
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={cn(BOX, "h-11")} />
        </Field>
        <Field label="Brand">
          <input value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} className={cn(BOX, "h-11")} />
        </Field>
        <Field label="Model">
          <input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} className={cn(BOX, "h-11")} />
        </Field>
        <Field label="Category">
          <input
            value={v.register_category}
            onChange={(e) => setV({ ...v, register_category: e.target.value })}
            list="item-categories"
            className={cn(BOX, "h-11")}
          />
          <datalist id="item-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        {item.tracking !== "tagged" && (
          <Field label="Where it's kept">
            <select
              value={v.location_id}
              onChange={(e) => setV({ ...v, location_id: e.target.value })}
              className={cn(BOX, "h-11")}
            >
              <option value="">Not set</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {item.tracking === "consumable" && (
          <Field label="Description" className="md:col-span-2">
            <textarea
              value={v.description}
              onChange={(e) => setV({ ...v, description: e.target.value })}
              rows={3}
              className={cn(BOX, "py-2.5")}
            />
          </Field>
        )}
        {item.tracking === "consumable" && (
          <Field label="Reorder at">
            <input
              value={v.reorder_at}
              onChange={(e) => setV({ ...v, reorder_at: e.target.value })}
              inputMode="numeric"
              className={cn(BOX, "h-11 tabular-nums")}
            />
          </Field>
        )}
        {item.tracking !== "consumable" && (
          <label className="flex min-h-[44px] items-center gap-3 text-[14px] text-[color:var(--hire-ink)] md:col-span-2">
            <input
              type="checkbox"
              checked={requestable}
              onChange={(e) => setRequestable(e.target.checked)}
              className="h-5 w-5 accent-[color:var(--hire-accent)]"
            />
            Schools and ministries can ask to borrow it
          </label>
        )}
        {error && <p className="text-[14px] text-[color:var(--hire-accent)] md:col-span-2">{error}</p>}
        <div className="flex gap-2.5 md:col-span-2">
          <button type="button" onClick={save} disabled={busy} className={PRIMARY}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
