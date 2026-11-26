"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/theme";

// System / Light / Dark for the whole Hub, saved to the person's profile
// (users.color_scheme, migration 344) so it follows them to every device.
// Used on /profile (Appearance) and in the menu next to My profile, so it is
// one tap away on a phone.
//
// The switch applies at once and is saved in the background; a failed save
// puts it back rather than leaving the screen showing something that won't
// stick.

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function useThemePreference(initial?: ThemePreference) {
  const [preference, setPreference] = useState<ThemePreference>(initial ?? "system");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without a server value, show what this device remembers (the shell keeps
  // the cookie in step with the profile on every signed-in page load).
  useEffect(() => {
    if (!initial) setPreference(readThemePreference());
  }, [initial]);

  async function choose(next: ThemePreference) {
    if (saving || next === preference) return;
    const previous = preference;
    applyThemePreference(next);
    setPreference(next);
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
    } catch (e) {
      applyThemePreference(previous);
      setPreference(previous);
      setError(e instanceof Error ? e.message : "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return { preference, choose, saving, error };
}

export function ThemeSwitch({
  preference,
  onChoose,
  disabled,
  size = "default",
  className,
}: {
  preference: ThemePreference;
  onChoose: (next: ThemePreference) => void;
  disabled?: boolean;
  size?: "default" | "compact";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Hub colours" className={cn("grid grid-cols-3 border border-ink", className)}>
      {OPTIONS.map(({ value, label, Icon }, i) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChoose(value)}
            className={cn(
              "flex min-w-0 items-center justify-center font-mono font-bold uppercase transition-colors disabled:cursor-wait",
              size === "compact"
                ? "min-h-10 gap-1.5 px-1.5 text-[9.5px] tracking-[0.12em]"
                : "min-h-[46px] gap-2 px-3 text-[10px] tracking-[0.14em]",
              i > 0 && "border-l border-ink",
              // Selected = the strongest ink as a fill: black on white in
              // light mode, bone-white on black in dark mode.
              active
                ? "bg-[rgb(var(--c-ink))] text-[color:rgb(var(--c-paper))]"
                : "bg-white text-ink hover:bg-bone"
            )}
          >
            <Icon className={size === "compact" ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Self-contained switch for the menu: reads and saves the preference itself. */
export function ThemeQuickSwitch({ className }: { className?: string }) {
  const { preference, choose, saving, error } = useThemePreference();
  return (
    <div className={className}>
      <p className="mono-label mb-2">Appearance</p>
      <ThemeSwitch preference={preference} onChoose={choose} disabled={saving} size="compact" />
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
