import { FlaskConical } from "lucide-react";
import type { ModuleVisibility } from "@/lib/module-visibility";

/**
 * Shown to super admins inside a module that is NOT live yet.
 *
 * Without this it is far too easy to walk a ministry leader through a
 * half-built page and have them assume it is shipped — you can see the module,
 * so nothing on screen tells you nobody else can.
 */
export function BetaModuleBanner({
  label,
  visibility,
}: {
  label: string;
  visibility: ModuleVisibility;
}) {
  if (visibility === "live") return null;

  const isBeta = visibility === "beta";

  return (
    <div className="mt-4 flex items-start gap-2.5 border border-amber-border bg-yellow-dim px-3.5 py-2.5">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-ink" />
      <div className="text-[13px] leading-snug text-[#45423B]">
        <span className="font-semibold text-ink">
          {isBeta ? "BETA" : "SWITCHED OFF"}
        </span>{" "}
        — {label} is{" "}
        {isBeta
          ? "visible to super admins only. Nobody else can see it in the menu or open the page."
          : "hidden from everyone, including you on a normal day. You are seeing this because the page is still linked."}{" "}
        <span className="opacity-70">Change this in Settings → Modules.</span>
      </div>
    </div>
  );
}
