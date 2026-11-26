"use client";

import { ThemeSwitch, useThemePreference } from "@/components/theme-switch";
import { preferenceFromSaved, type ColorScheme } from "@/lib/theme";

// Appearance on /profile: System / Light / Dark for the whole Hub, saved to
// the person's profile (users.color_scheme) so it follows them to every
// device. System (the default) follows the device, including when it switches
// to dark at sunset. The same switch sits in the menu next to My profile.

export function AppearanceCard({ saved }: { saved: ColorScheme | null }) {
  const { preference, choose, saving, error } = useThemePreference(preferenceFromSaved(saved));

  return (
    <div className="border border-ink bg-white">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="min-w-0">
          <p className="font-display text-[18px] font-black uppercase leading-none text-ink">Light or dark</p>
          <p className="mt-1.5 text-sm text-[color:var(--text-secondary)]">
            {preference === "system"
              ? "Following this device, so the Hub goes dark when your phone or computer does."
              : "Saved to your profile, so every device you sign in on uses it."}
          </p>
        </div>
        <ThemeSwitch
          preference={preference}
          onChoose={choose}
          disabled={saving}
          className="w-full shrink-0 md:w-[360px]"
        />
      </div>
      {error && (
        <p role="alert" className="border-t border-rule px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
