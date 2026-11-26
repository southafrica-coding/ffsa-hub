import { Archivo, Fraunces, Roboto_Mono } from "next/font/google";

/** Body / UI face for Missio (build guide §2): Archivo. Shared by the layout and the portaled dialog. */
export const missioBody = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-missio-body",
  display: "swap",
});

/**
 * Titles and big numbers: Fraunces, variable on weight and optical size so
 * titles sit at the guide's ~560. The dialog portals to document.body, so it
 * has to carry this itself.
 */
export const missioDisplay = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-missio-display",
  display: "swap",
});

/** Times and IDs only. */
export const missioMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-missio-mono",
  display: "swap",
});
