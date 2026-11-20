"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { applyColorScheme, type ColorScheme } from "@/lib/theme";

// Light / Dark for the whole Hub, saved to the person's profile
// (users.color_scheme) so it follows them to every device. Until they pick,
// the Hub follows the device; the button for whatever is showing now is lit.
//
// The switch applies at once and is saved in the background; a failed save
// puts it back rather than leaving the screen showing something that won't
// stick.

const OPTIONS: { value: ColorScheme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function AppearanceCard({ saved }: { saved: ColorScheme | null }) {
  const [current, setCurrent] = useState<ColorScheme | null>(saved);
  const [isSaved, setIsSaved] = useState(saved !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing saved: show whatever the device chose before paint.
  useEffect(() => {
    if (saved === null) {
      setCurrent(document.documentElement.classList.contains("dark") ? "dark" : "light");
    }
  }, [saved]);

  async function choose(next: ColorScheme) {
    if (saving || (next === current && isSaved)) return;
    const previous = current;
    const wasSaved = isSaved;
    applyColorScheme(next);
    setCurrent(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/appearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorScheme: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save your setting. Please try again.");
      }
      setIsSaved(true);
    } catch (e) {
      if (previous) applyColorScheme(previous);
      setCurrent(previous);
      setIsSaved(wasSaved);
      setError(e instanceof Error ? e.message : "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-ink bg-white">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="min-w-0">
          <p className="font-display text-[18px] font-black uppercase leading-none text-ink">
            Light or dark
          </p>
          <p className="mt-1.5 text-sm text-[color:var(--text-secondary)]">
            {isSaved
              ? "Saved to your profile, so every device you sign in on uses it."
              : "Following this device for now. Pick one and it's saved to your profile."}
          </p>
        </div>
        <div role="radiogroup" aria-label="Hub colours" className="grid shrink-0 grid-cols-2 border border-ink">
          {OPTIONS.map(({ value, label, Icon }) => {
            const active = current === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving}
                onClick={() => choose(value)}
                className={cn(
                  "flex min-h-[46px] min-w-[120px] items-center justify-center gap-2 px-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors",
                  value === "dark" && "border-l border-ink",
                  // Selected = the strongest ink as a fill: black on white in
                  // light mode, bone-white on black in dark mode.
                  active
                    ? "bg-[rgb(var(--c-ink))] text-[color:rgb(var(--c-paper))]"
                    : "bg-white text-ink hover:bg-bone"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="border-t border-rule px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
