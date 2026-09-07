"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { ModuleVisibility } from "@/lib/module-visibility";

export type ModuleRow = {
  key: string;
  label: string;
  href: string;
  description: string;
  visibility: ModuleVisibility;
  note: string;
};

const STATES: { value: ModuleVisibility; label: string; hint: string }[] = [
  { value: "live", label: "Live", hint: "Normal permissions apply" },
  { value: "beta", label: "Beta", hint: "Super admins only" },
  { value: "hidden", label: "Off", hint: "Nobody, including you" },
];

export function ModuleVisibilityTable({ rows }: { rows: ModuleRow[] }) {
  const router = useRouter();
  const [local, setLocal] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  async function save(key: string, patch: Partial<ModuleRow>) {
    const before = local;
    setLocal((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/module-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, ...patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't save that change.");
      }
      // The nav lives in the layout, so a refresh is what makes a module
      // actually appear or disappear for you straight away.
      router.refresh();
    } catch (e) {
      setLocal(before); // roll the optimistic update back
      setError(e instanceof Error ? e.message : "Couldn't save that change.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="border border-red-300 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">
          {error}
        </div>
      )}

      <div className="border border-rule">
        {local.map((row, i) => (
          <div
            key={row.key}
            className={cn(
              "flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:justify-between",
              i > 0 && "border-t border-rule",
              row.visibility !== "live" && "bg-yellow-dim/40"
            )}
          >
            <div className="min-w-0 md:pr-6">
              <div className="font-semibold text-[14px] text-ink">{row.label}</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-[color:var(--text-secondary)]">
                {row.description}
              </div>
              <div className="mono-label mt-1.5 opacity-60">{row.href}</div>

              {row.visibility !== "live" && (
                <div className="mt-2.5">
                  <input
                    type="text"
                    placeholder="What's being tested? (optional)"
                    defaultValue={row.note}
                    onChange={(e) =>
                      setNoteDraft((d) => ({ ...d, [row.key]: e.target.value }))
                    }
                    onBlur={() => {
                      const next = noteDraft[row.key];
                      if (next !== undefined && next !== row.note) {
                        save(row.key, { note: next });
                      }
                    }}
                    className="w-full max-w-md border border-rule bg-white px-2.5 py-1.5 text-[13px] text-ink"
                  />
                </div>
              )}
            </div>

            <div className="flex shrink-0 border border-ink">
              {STATES.map((s) => {
                const active = row.visibility === s.value;
                return (
                  <button
                    key={s.value}
                    title={s.hint}
                    disabled={busy === row.key}
                    onClick={() => save(row.key, { visibility: s.value })}
                    className={cn(
                      "px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50",
                      active
                        ? "bg-ink text-white"
                        : "bg-white text-ink hover:bg-bone-2"
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[12.5px] leading-relaxed text-[color:var(--text-secondary)]">
        Note: this hides pages, not data or APIs. A module in Beta can still
        have background jobs, emails or Slack posts running, and any rows it
        writes are visible to the rest of the Hub.
      </p>
    </div>
  );
}
