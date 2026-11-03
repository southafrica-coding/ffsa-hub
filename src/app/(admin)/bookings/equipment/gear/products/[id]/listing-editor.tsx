"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  centsToInput,
  goLiveBlockers,
  listingWarnings,
  parseLines,
  parseRands,
  parseSpecs,
  specsToText,
} from "@/lib/equipment/listing";

type ProductFields = {
  id: string;
  slug: string;
  is_listed: boolean;
  can_leave_building: boolean;
  price_day_cents: number | null;
  price_weekend_cents: number | null;
  price_week_cents: number | null;
  deposit_cents: number;
  internal_day_cents: number;
  description: string | null;
  included: string[];
  specs: Record<string, string>;
  store_category_id: string | null;
  replacement_value_cents: number | null;
  sortly_sid: string | null;
};

type MoneyKey = "day" | "weekend" | "week" | "deposit" | "internal" | "replacement";

export function ListingEditor({
  canEdit,
  product,
  bookable,
  photos: initialPhotos,
  categories,
}: {
  canEdit: boolean;
  product: ProductFields;
  bookable: number;
  photos: { id: string; url: string }[];
  categories: { id: string; label: string }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [leave, setLeave] = useState(product.can_leave_building);
  const [money, setMoney] = useState<Record<MoneyKey, string>>({
    day: centsToInput(product.price_day_cents),
    weekend: centsToInput(product.price_weekend_cents),
    week: centsToInput(product.price_week_cents),
    deposit: centsToInput(product.deposit_cents),
    internal: centsToInput(product.internal_day_cents),
    replacement: centsToInput(product.replacement_value_cents),
  });
  const [description, setDescription] = useState(product.description ?? "");
  const [included, setIncluded] = useState(product.included.join("\n"));
  const [specs, setSpecs] = useState(specsToText(product.specs));
  const [category, setCategory] = useState(product.store_category_id ?? "");
  const [photos, setPhotos] = useState(initialPhotos);

  const [busy, setBusy] = useState<null | "save" | "live" | "off" | "photo">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => {
    const day = parseRands(money.day);
    const weekend = parseRands(money.weekend);
    const week = parseRands(money.week);
    const deposit = parseRands(money.deposit) ?? 0;
    const internal = parseRands(money.internal) ?? 0;
    const replacement = parseRands(money.replacement);
    const bad = [day, weekend, week, deposit, internal, replacement].some((v) => Number.isNaN(v));
    return { day, weekend, week, deposit, internal, replacement, bad };
  }, [money]);

  const fields = {
    can_leave_building: leave,
    price_day_cents: parsed.day,
    price_weekend_cents: parsed.weekend,
    price_week_cents: parsed.week,
    store_category_id: category || null,
  };
  const blockers = goLiveBlockers(fields);
  const warnings = listingWarnings(fields, { photos: photos.length, bookable });

  function payload() {
    return {
      ...fields,
      deposit_cents: parsed.deposit,
      internal_day_cents: parsed.internal,
      description: description.trim() || null,
      included: parseLines(included),
      specs: parseSpecs(specs),
      // Only when it changed, so saving never depends on it otherwise.
      ...(parsed.replacement !== product.replacement_value_cents
        ? { replacement_value_cents: parsed.replacement }
        : {}),
    };
  }

  async function save(kind: "save" | "live" | "off") {
    if (parsed.bad) {
      setError("A price isn't a number. Use rands, like 120 or 120.50.");
      return;
    }
    setBusy(kind);
    setError(null);
    setSaved(false);
    const body: Record<string, unknown> = payload();
    if (kind === "live") body.is_listed = true;
    if (kind === "off") body.is_listed = false;
    const res = await fetch(`/api/equipment/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(json.error ?? "That didn't save. Try again.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("photo");
    setError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/equipment/products/${product.id}/photos`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "That photo didn't upload.");
        break;
      }
      setPhotos((p) => [...p, { id: json.photo.id, url: json.photo.url }]);
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function removePhoto(id: string) {
    setBusy("photo");
    const res = await fetch(`/api/equipment/products/${product.id}/photos/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) setPhotos((p) => p.filter((x) => x.id !== id));
    else setError("That photo couldn't be removed.");
    router.refresh();
  }

  const box = "rounded-[8px] border border-[color:var(--hire-line-strong)]";
  const disabled = !canEdit;

  return (
    <div className="pb-6">
      {!canEdit && (
        <p className="border-b border-[color:var(--hire-line)] px-[18px] py-3 text-[14px] md:px-9">
          Only the rental manager can change a listing. You can see it here.
        </p>
      )}

      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4 px-[18px] py-4 md:border-r md:border-[color:var(--hire-line)] md:px-9 md:py-6">
          {/* Can leave the building */}
          <label className={cn(box, "flex min-h-[52px] items-center justify-between gap-4 px-3.5")}>
            <span className="text-[15px] text-[color:var(--hire-ink)]">
              Can leave the building
              <span className="block text-[12px] text-[color:var(--hire-muted)]">
                Off for anything that has to stay installed here.
              </span>
            </span>
            <Toggle checked={leave} onChange={setLeave} disabled={disabled} label="Can leave the building" />
          </label>

          <div>
            <div className="hire-label mb-2">Public price, excl. VAT</div>
            <div className="grid grid-cols-3 gap-2">
              <MoneyBox label="Day" value={money.day} onChange={(v) => setMoney({ ...money, day: v })} disabled={disabled} required />
              <MoneyBox label="Weekend" hint="Fri–Mon" value={money.weekend} onChange={(v) => setMoney({ ...money, weekend: v })} disabled={disabled} />
              <MoneyBox label="Week" hint="5–7 days" value={money.week} onChange={(v) => setMoney({ ...money, week: v })} disabled={disabled} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MoneyBox label="Deposit, each" value={money.deposit} onChange={(v) => setMoney({ ...money, deposit: v })} disabled={disabled} />
            <MoneyBox label="Ministry rate, a day" value={money.internal} onChange={(v) => setMoney({ ...money, internal: v })} disabled={disabled} />
          </div>

          {/* Internal: never on the store, never charged (migration 285). */}
          <div className="rounded-[8px] border border-dashed border-[color:var(--hire-line-strong)] p-2.5">
            <MoneyBox
              label="Replacement value per unit (internal, not shown to customers)"
              value={money.replacement}
              onChange={(v) => setMoney({ ...money, replacement: v })}
              disabled={disabled}
            />
            <p className="mt-1.5 px-1 text-[12px] text-[color:var(--hire-muted)]">
              A guide for lost or damaged gear, from the first inventory. Not a hire price.
              {product.sortly_sid && (
                <>
                  {" "}
                  Sortly id <span className="hire-mono text-[color:var(--hire-body)]">{product.sortly_sid}</span>.
                </>
              )}
            </p>
          </div>

          {/* Photos */}
          <div>
            <div className="hire-label mb-2">
              Photos · {photos.length}
            </div>
            <div className="grid grid-cols-4 gap-1.5 md:grid-cols-6">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-[6px] bg-[color:var(--hire-surface2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      disabled={busy !== null}
                      aria-label="Remove photo"
                      className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-[999px] bg-black/70 text-[color:var(--hire-ink)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== null}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-[color:var(--hire-dim)] text-[12px] text-[color:var(--hire-muted)]"
                >
                  {busy === "photo" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  Add
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
          </div>

          <Field label="Description" hint="A line or two for the item page.">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={disabled}
              rows={3}
              className={cn(box, "w-full px-3.5 py-3 text-[15px]")}
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="What's included" hint="One thing per line.">
              <textarea
                value={included}
                onChange={(e) => setIncluded(e.target.value)}
                disabled={disabled}
                rows={5}
                placeholder={"Microphone\nStand clip\nXLR cable, 5 m"}
                className={cn(box, "w-full px-3.5 py-3 text-[15px]")}
              />
            </Field>
            <Field label="Specs" hint="Name: value, one per line.">
              <textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                disabled={disabled}
                rows={5}
                placeholder={"Type: Dynamic, cardioid\nConnector: XLR, 3-pin"}
                className={cn(box, "w-full px-3.5 py-3 text-[15px]")}
              />
            </Field>
          </div>
          <Field label="Store category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={disabled}
              className={cn(box, "min-h-[50px] w-full px-3.5 text-[15px]")}
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Checklist: what stops it going live, and what's worth fixing. */}
        <aside className="flex flex-col gap-4 border-t border-[color:var(--hire-line)] px-[18px] py-4 md:border-t-0 md:bg-[color:var(--hire-surface)] md:px-7 md:py-6">
          <div>
            <div className="hire-label mb-2">Store</div>
            <p className="text-[14px] text-[color:var(--hire-ink)]">
              {product.is_listed ? (
                <>
                  On the store.{" "}
                  <Link href={`/hire/p/${product.slug}`} className="text-[color:var(--hire-accent)] underline underline-offset-4">
                    See it
                  </Link>
                </>
              ) : (
                "Not on the store."
              )}
            </p>
            <p className="mt-1 text-[13px]">
              {bookable} {bookable === 1 ? "unit is" : "units are"} bookable.
            </p>
          </div>
          {blockers.length > 0 && (
            <div>
              <div className="hire-label mb-2 !text-[color:var(--hire-accent)]">Before it can go live</div>
              <ul className="flex flex-col gap-1.5 text-[14px] text-[color:var(--hire-ink)]">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <div className="hire-label mb-2">Worth fixing</div>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {canEdit && (
        <div className="sticky bottom-[72px] z-10 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] px-[18px] py-3 md:bottom-0 md:px-9">
          {error && <p className="mb-2 text-[14px] text-[color:var(--hire-accent)]">{error}</p>}
          {saved && !error && <p className="mb-2 text-[13px] text-[color:var(--hire-ok)]">Saved.</p>}
          <div className="flex gap-2.5 md:justify-end">
            <button
              type="button"
              onClick={() => save("save")}
              disabled={busy !== null}
              className="flex h-[52px] flex-1 items-center justify-center rounded-[8px] border border-[color:var(--hire-line-strong)] px-5 text-[15px] text-[color:var(--hire-ink)] md:h-11 md:flex-none"
            >
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </button>
            {product.is_listed ? (
              <button
                type="button"
                onClick={() => save("off")}
                disabled={busy !== null}
                className="flex h-[52px] flex-[2] items-center justify-center rounded-[8px] border border-[color:var(--hire-accent)] px-5 text-[15px] font-bold text-[color:var(--hire-accent)] md:h-11 md:flex-none"
              >
                {busy === "off" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Take it off the store"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => save("live")}
                disabled={busy !== null || blockers.length > 0}
                title={blockers.join(" ")}
                className={cn(
                  "flex h-[52px] flex-[2] items-center justify-center rounded-[8px] px-5 text-[15px] font-bold md:h-11 md:flex-none",
                  blockers.length > 0
                    ? "bg-[color:var(--hire-surface2)] text-[color:var(--hire-dim)]"
                    : "bg-[color:var(--hire-accent)] text-[color:var(--hire-on-accent)]"
                )}
              >
                {busy === "live" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Go live · ${bookable} bookable`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-[46px] shrink-0 rounded-[999px] transition-colors",
        checked ? "bg-[color:var(--hire-accent)]" : "bg-[color:var(--hire-line-strong)]"
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-[22px] w-[22px] rounded-[999px] transition-all",
          checked ? "right-[3px] bg-[color:var(--hire-on-accent)]" : "left-[3px] bg-[color:var(--hire-muted)]"
        )}
      />
    </button>
  );
}

function MoneyBox({
  label,
  hint,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const bad = Number.isNaN(parseRands(value));
  return (
    <label
      className={cn(
        "block rounded-[8px] border px-2.5 py-2",
        bad ? "border-[color:var(--hire-accent)]" : "border-[color:var(--hire-line-strong)]"
      )}
    >
      <span className="block text-[11px] text-[color:var(--hire-muted)]">
        {label}
        {hint && <span className="hidden sm:inline"> · {hint}</span>}
      </span>
      <span className="hire-display flex items-baseline gap-1 text-[26px]">
        <span>R</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={required ? "—" : "none"}
          aria-label={label}
          className="hire-bare w-full min-w-0 outline-none"
        />
      </span>
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="hire-label mb-2 block">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal text-[color:var(--hire-dim)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
