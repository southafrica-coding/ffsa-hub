// Pricing: the one row of equipment_settings (VAT, waiver, deposit refund
// days, agreement version, Xero item code) and every product's prices at a
// glance, each linking to its listing editor.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import {
  getEquipmentAccess,
  getEquipmentSettings,
  listProducts,
  type EquipmentProduct,
  type EquipmentSettings,
} from "@/services/equipment";
import { randsShort } from "@/lib/equipment/money";
import { SettingsForm } from "./settings-form";

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [settingsRes, productsRes, access] = await Promise.all([
    getEquipmentSettings(supabase),
    listProducts(supabase),
    user ? getEquipmentAccess(supabase, user.id) : null,
  ]);
  const settings = settingsRes.data as EquipmentSettings | null;
  const products = (productsRes.data ?? []) as EquipmentProduct[];
  const price = (c: number | null) => (c == null ? "—" : randsShort(c));

  return (
    <div className="pb-8">
      <header className="border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-4 md:px-9 md:pb-5 md:pt-7">
        <div className="text-[13px] text-[color:var(--hire-muted)]">Equipment · what every hire adds up to</div>
        <h1 className="hire-display mt-0.5 text-[52px] md:text-[72px]">Pricing</h1>
      </header>

      {settings ? (
        <SettingsForm canEdit={!!access?.canManage} settings={settings} />
      ) : (
        <p className="px-[18px] py-6 md:px-9">The settings row is missing. Migration 255 creates it.</p>
      )}

      <section className="mt-2">
        <h2 className="hire-display px-[18px] pb-2 pt-6 text-[30px] md:px-9">Product prices</h2>
        <p className="px-[18px] pb-3 text-[13px] text-[color:var(--hire-muted)] md:px-9">
          Excl. VAT. Open a product to change its prices or put it on the store.
        </p>
        <div className="hidden grid-cols-[minmax(0,1fr)_90px_90px_90px_90px_90px_110px] gap-3 bg-[color:var(--hire-surface)] px-9 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--hire-muted)] md:grid">
          <span>Product</span>
          <span>Day</span>
          <span>Weekend</span>
          <span>Week</span>
          <span>Deposit</span>
          <span>Ministry</span>
          <span>Store</span>
        </div>
        <ul>
          {products.map((p) => (
            <li key={p.id} className="border-b border-[color:var(--hire-line)]">
              <Link
                href={`/bookings/equipment/gear/products/${p.id}`}
                className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-[18px] py-2.5 hover:bg-[color:var(--hire-surface)] md:grid-cols-[minmax(0,1fr)_90px_90px_90px_90px_90px_110px] md:px-9"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-[color:var(--hire-ink)] md:text-[14px]">
                    {[p.brand, p.model].filter(Boolean).join(" ") || p.name}
                  </span>
                  <span className="block truncate text-[12px] text-[color:var(--hire-muted)]">
                    {p.name}
                    <span className="md:hidden">
                      {" · "}
                      {p.price_day_cents == null ? "no price" : `${price(p.price_day_cents)} a day`}
                    </span>
                  </span>
                </span>
                <span className="hidden text-[14px] md:inline">{price(p.price_day_cents)}</span>
                <span className="hidden text-[14px] md:inline">{price(p.price_weekend_cents)}</span>
                <span className="hidden text-[14px] md:inline">{price(p.price_week_cents)}</span>
                <span className="hidden text-[14px] md:inline">{p.deposit_cents ? randsShort(p.deposit_cents) : "—"}</span>
                <span className="hidden text-[14px] md:inline">{randsShort(p.internal_day_cents)}</span>
                <span
                  className={cn(
                    "text-[12px] font-bold uppercase tracking-[0.12em]",
                    p.is_listed ? "text-[color:var(--hire-ok)]" : "text-[color:var(--hire-dim)]"
                  )}
                >
                  {p.is_listed ? "Listed" : "Not listed"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
