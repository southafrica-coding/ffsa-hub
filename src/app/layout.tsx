import type { Metadata } from "next";
import { Roboto, Roboto_Condensed, Roboto_Mono, Bebas_Neue, Anton, Space_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const roboto = Roboto({
  // 900 = Roboto Black, the FFSA brand deck's mandated display weight.
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-roboto",
});
// Editorial-light redesign display + label faces.
const robotoCondensed = Roboto_Condensed({
  weight: ["400", "700", "900"],
  subsets: ["latin"],
  variable: "--font-roboto-condensed",
});
const robotoMono = Roboto_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-roboto-mono",
});
// No longer part of the hub brand, but bespoke public event storefronts
// (e.g. THE SEND) still read var(--font-bebas) directly — keep it loaded
// until those pages are migrated.
const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas",
});
// Loaded for bespoke event landing pages (e.g. THE SEND). Tree-shaken
// off other routes by Next/font; safe to keep in the root layout.
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});
const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000"
  ),
  title: {
    default: "FFSA Hub",
    template: "%s · FFSA Hub",
  },
  description: "Fire & Fragrance South Africa — Internal Operations Platform",
  applicationName: "FFSA Hub",
  openGraph: {
    title: "FFSA Hub",
    description: "Fire & Fragrance South Africa — Internal Operations Platform",
    siteName: "FFSA Hub",
    images: ["/brand/ff-wordmark-black.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoCondensed.variable} ${robotoMono.variable} ${bebasNeue.variable} ${anton.variable} ${spaceMono.variable}`}>
      <body className={roboto.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
