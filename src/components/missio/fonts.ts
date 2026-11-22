import { Cormorant_Garamond, DM_Sans } from "next/font/google";

/** Body face for Missio (MissioSA Brand Guide): DM Sans. Shared by the layout and the portaled dialog. */
export const missioBody = DM_Sans({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-missio-body",
  display: "swap",
});

/** Display face for Missio headings: Cormorant Garamond. The dialog portals to document.body, so it has to carry this itself. */
export const missioDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-missio-display",
  display: "swap",
});
