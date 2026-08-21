"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { SearchableSelect } from "@/components/ui/searchable-select";
import type { OkrCycle } from "@/types/okrs";

/**
 * Cycle picker for the masthead. Deliberately a SearchableSelect, which is a
 * native <select> — the Radix popover version of this control does not open in
 * Safari, and half the base is on it.
 */
export function CycleSwitcher({ cycles, active }: { cycles: OkrCycle[]; active: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (cycles.length <= 1) return null;

  return (
    <SearchableSelect
      value={active}
      onChange={(slug) => {
        const next = new URLSearchParams(params.toString());
        next.set("cycle", slug);
        router.push(`${pathname}?${next.toString()}`);
      }}
      options={cycles.map((c) => ({
        value: c.slug,
        label: c.is_current ? `${c.name} (current)` : c.name,
      }))}
      placeholder="Cycle"
    />
  );
}
