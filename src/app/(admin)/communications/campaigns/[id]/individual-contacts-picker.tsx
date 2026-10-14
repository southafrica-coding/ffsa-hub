"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { PickableContact } from "@/services/campaigns";

function nameOf(c: PickableContact): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unnamed contact";
}

/**
 * Search contacts by name or email and hand-pick them onto a campaign
 * (migration 234). Controlled: the composer owns the picked list and saves it
 * with the rest of the campaign. People who can't be emailed (unsubscribed,
 * bounced, no address) show why, and stay out of the send even if picked.
 */
export function IndividualContactsPicker({
  picked,
  onChange,
  disabled,
}: {
  picked: PickableContact[];
  onChange: (next: PickableContact[]) => void;
  disabled: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickableContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search; ignores a stale response if the query moved on.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/campaigns/contact-search?q=${encodeURIComponent(term)}`
      ).catch(() => null);
      const data = res?.ok
        ? ((await res.json()) as { contacts: PickableContact[] })
        : { contacts: [] };
      if (!cancelled) {
        setResults(data.contacts);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Close the results list on an outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickedIds = new Set(picked.map((p) => p.id));

  function add(c: PickableContact) {
    if (pickedIds.has(c.id)) return;
    onChange([...picked, c]);
    setQ("");
    setResults([]);
  }

  return (
    <div className="space-y-2">
      {picked.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No individual contacts — search below to add people one by one.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((c) => (
            <span
              key={c.id}
              title={c.blocked ? `Won't be emailed: ${c.blocked}` : c.email ?? ""}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                c.blocked ? "border-dashed text-muted-foreground line-through" : "bg-muted"
              }`}
            >
              {nameOf(c)}
              {c.blocked && <span className="no-underline">({c.blocked})</span>}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(picked.filter((p) => p.id !== c.id))}
                  className="hover:text-red-400"
                  aria-label={`Remove ${nameOf(c)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <div ref={boxRef} className="relative">
          <div className="flex items-center gap-2 rounded border px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = results.find((r) => !pickedIds.has(r.id));
                  if (first) add(first);
                }
              }}
              placeholder="Search contacts by name or email…"
              className="w-full bg-transparent py-1.5 text-sm outline-none"
              aria-label="Search contacts to add"
            />
          </div>

          {open && q.trim().length >= 2 && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border bg-white shadow-md">
              {loading && results.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  No contacts match &ldquo;{q.trim()}&rdquo;. Add them in Contacts first.
                </li>
              ) : (
                results.map((c) => {
                  const already = pickedIds.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={already}
                        onClick={() => add(c)}
                        className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className={c.blocked ? "text-muted-foreground" : "font-medium"}>
                            {nameOf(c)}
                          </span>{" "}
                          <span className="truncate text-xs text-muted-foreground">
                            {c.email ?? ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {already ? "Added" : c.blocked ?? ""}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
