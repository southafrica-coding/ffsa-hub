"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

type ImportOption = { id: string; label: string };

/**
 * Filter / search bar that lives above the persons table on the
 * /records-library/persons browse page. All filter state lives in the URL
 * search params so links are shareable and back/forward navigation works.
 *
 * Search is debounced (300ms) — every other change navigates immediately.
 */
export function PersonsBrowser({
  initialQuery,
  importOptions,
  currentImport,
  currentLinked,
  currentCountry,
  currentNationality,
  currentSort,
  countries,
  nationalities,
}: {
  initialQuery: string;
  importOptions: ImportOption[];
  currentImport: string;
  currentLinked: string;
  currentCountry: string;
  currentNationality: string;
  currentSort: string;
  countries: string[];
  nationalities: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  // Push every-key debounce of the search input into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = buildUrl(searchParams, { q: query || null, page: null });
      router.push(next, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function setParam(key: string, value: string) {
    const next = buildUrl(searchParams, {
      [key]: value || null,
      page: null,
    });
    router.push(next, { scroll: false });
  }

  function clearAll() {
    router.push("/records-library/persons", { scroll: false });
    setQuery("");
  }

  const activeFilters: string[] = [];
  if (initialQuery) activeFilters.push(`Search: "${initialQuery}"`);
  if (currentImport) {
    const label =
      importOptions.find((o) => o.id === currentImport)?.label ?? "import";
    activeFilters.push(`Source: ${label}`);
  }
  if (currentLinked !== "all" && currentLinked) {
    activeFilters.push(
      currentLinked === "linked" ? "Linked only" : "Unlinked only"
    );
  }
  if (currentCountry) activeFilters.push(`Country: ${currentCountry}`);
  if (currentNationality) activeFilters.push(`Nationality: ${currentNationality}`);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[1fr_repeat(4,minmax(0,160px))_140px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full pl-8 pr-3 py-2 text-sm border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-blue-500/40"
          />
        </div>

        <select
          value={currentImport}
          onChange={(e) => setParam("import", e.target.value)}
          className="px-2 py-2 text-sm border rounded-md bg-card"
        >
          <option value="">All imports</option>
          {importOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={currentLinked}
          onChange={(e) => setParam("linked", e.target.value)}
          className="px-2 py-2 text-sm border rounded-md bg-card"
        >
          <option value="all">Any link status</option>
          <option value="linked">Linked to user</option>
          <option value="unlinked">Unlinked</option>
        </select>

        <select
          value={currentCountry}
          onChange={(e) => setParam("country", e.target.value)}
          className="px-2 py-2 text-sm border rounded-md bg-card"
        >
          <option value="">Any country</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={currentNationality}
          onChange={(e) => setParam("nationality", e.target.value)}
          className="px-2 py-2 text-sm border rounded-md bg-card"
        >
          <option value="">Any nationality</option>
          {nationalities.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <select
          value={currentSort}
          onChange={(e) => setParam("sort", e.target.value)}
          className="px-2 py-2 text-sm border rounded-md bg-card"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
          <option value="email">Email A–Z</option>
        </select>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {activeFilters.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bone text-electric border border-rule-strong"
            >
              {f}
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Build a fresh URL from existing search params plus overrides. Passing a
 * `null` value removes the param. Page is implicitly reset to 1 by
 * passing `page: null` from callers when a filter changes.
 */
function buildUrl(
  current: URLSearchParams,
  overrides: Record<string, string | null>
): string {
  const next = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return `/records-library/persons${qs ? "?" + qs : ""}`;
}
