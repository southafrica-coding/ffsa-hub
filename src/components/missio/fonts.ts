import { Archivo, Fraunces } from "next/font/google";

/** Body face for the Missio church. Shared by the layout and the portaled dialog. */
export const missioBody = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-missio-body",
  display: "swap",
});

/** Display face for Missio headings. The dialog portals to document.body, so it has to carry this itself. */
export const missioDisplay = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-missio-display",
  display: "swap",
});
