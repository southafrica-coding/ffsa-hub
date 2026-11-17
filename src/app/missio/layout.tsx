import type { Metadata } from "next";
import { Archivo, Fraunces } from "next/font/google";
import { MissioFrame } from "@/components/missio/shell";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-missio-body",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-missio-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: { absolute: "Missio" },
};

export default function MissioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.variable} ${fraunces.variable} ${archivo.className}`}>
      <MissioFrame>{children}</MissioFrame>
    </div>
  );
}
