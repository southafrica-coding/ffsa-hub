import type { Metadata } from "next";
import { Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google";
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
    <html lang="en" className={`${roboto.variable} ${robotoCondensed.variable} ${robotoMono.variable}`}>
      <body className={roboto.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
