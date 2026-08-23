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

  // The width wrapper is load-bearing. SearchableSelect sizes its <select>
  // w-full inside a div with no width of its own, which is right in a form
  // column but wrong here: Masthead's actions slot is a flex row, so the div
  // becomes a shrinkable flex item, collapses under the label's natural width,
  // and the absolutely-positioned chevron ends up on top of "2026 (current)".
  // Masthead's own shrink-0 protects the container, not this child.
  return (
    <div className="w-full min-w-[11rem] shrink-0 sm:w-[13rem]">
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
    </div>
  );
}
