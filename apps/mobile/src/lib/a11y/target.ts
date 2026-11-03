import type { Insets } from "react-native";

import { touch } from "@/theme/tokens";

/**
 * Extra touch area so a control drawn smaller than 48x48 (an icon, a chip)
 * still takes a 48dp finger. Prefer minHeight/minWidth when the layout allows;
 * use this when the visual size must stay small.
 */
export function hitSlopFor(width: number, height: number = width, min: number = touch.minTarget): Insets {
  const x = Math.max(0, Math.ceil((min - width) / 2));
  const y = Math.max(0, Math.ceil((min - height) / 2));
  return { top: y, bottom: y, left: x, right: x };
}

/** Size + slop on one axis: the area a finger can actually hit. */
export function effectiveTarget(size: number, slop: number | Insets | null | undefined, axis: "x" | "y"): number {
  if (slop == null) return size;
  if (typeof slop === "number") return size + slop * 2;
  return axis === "x" ? size + (slop.left ?? 0) + (slop.right ?? 0) : size + (slop.top ?? 0) + (slop.bottom ?? 0);
}

/** Style that makes a pressable at least 48x48. */
export const minTarget = { minHeight: touch.minTarget, minWidth: touch.minTarget } as const;
