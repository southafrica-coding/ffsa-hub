// The public storefront: dark, no login needed to browse (spec, Routes).
// Only listed products ever reach these pages — RLS sees to that.

import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { HIRE_CSS } from "@/lib/equipment/hire-theme";
import { listCategories, type EquipmentCategory } from "@/services/equipment";
import { StoreHeader, StoreTabBar } from "./_components/store-chrome";

export const metadata: Metadata = {
  title: "Hire · Fire & Fragrance",
  description: "Sound, screens and stage gear to hire from Fire & Fragrance South Africa. Pick your dates and see what's free.",
};

export default async function HireLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: cats }, { data: auth }] = await Promise.all([
    listCategories(supabase, { visibleOnly: true }),
    supabase.auth.getUser(),
  ]);
  const top = ((cats ?? []) as EquipmentCategory[])
    .filter((c) => !c.parent_id)
    .map((c) => ({ slug: c.slug, name: c.name }));

  return (
    <div className="theme-hire min-h-[100dvh] pb-[76px] md:pb-0">
      <style dangerouslySetInnerHTML={{ __html: HIRE_CSS }} />
      <Suspense fallback={<div className="h-[52px] border-b border-[color:var(--hire-line)] md:h-[68px]" />}>
        <StoreHeader categories={top} signedIn={!!auth.user} />
      </Suspense>
      {children}
      <Suspense fallback={null}>
        <StoreTabBar />
      </Suspense>
    </div>
  );
}
