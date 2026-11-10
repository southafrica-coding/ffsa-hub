import { Anton, Bebas_Neue, Space_Mono } from "next/font/google";

// THE SEND's own faces. Loaded here, not in the hub root, so the rest of
// the app does not download them.

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas",
});

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});

export const theSendFontClass = `${spaceMono.variable} ${bebas.variable} ${anton.variable}`;
