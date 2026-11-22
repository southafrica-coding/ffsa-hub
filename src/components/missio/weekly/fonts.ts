import { Cormorant_Garamond, DM_Sans } from "next/font/google";

// MissioSA Brand Guide v1.0 (2026): Cormorant Garamond 500/600 and italic
// for display, DM Sans 400/650/700 for body, labels and the wordmark.
// Only the weekly feedback fill and Sunday results use these for now;
// the rest of Missio is reskinned in a separate PR.

export const guideDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-guide-display",
  display: "swap",
});

/** Variable, so the Guide's 650 label weight is real, not rounded. */
export const guideBody = DM_Sans({
  subsets: ["latin"],
  variable: "--font-guide-body",
  display: "swap",
});
