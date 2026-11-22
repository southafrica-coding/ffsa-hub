import type { Metadata } from "next";
import "@/components/missio/missio-theme.css";
import { MissioFrame } from "@/components/missio/shell";
import { missioBody, missioDisplay } from "@/components/missio/fonts";

export const metadata: Metadata = {
  title: { absolute: "Missio" },
};

export default function MissioLayout({ children }: { children: React.ReactNode }) {
  return (
    // theme-light: Missio has its own skin and never takes the Hub's dark
    // mode (black and gold). It also re-pins the Hub tokens (--ink,
    // --surface-1 …) that Missio surfaces fall back to. Missio's own ink
    // ground comes from missio-theme.css and the shell's Auto / Light / Dark.
    <div data-missio-font="" className={`theme-light ${missioBody.variable} ${missioDisplay.variable} ${missioBody.className}`}>
      <MissioFrame>{children}</MissioFrame>
    </div>
  );
}
