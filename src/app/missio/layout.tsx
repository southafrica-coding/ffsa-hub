import type { Metadata } from "next";
import { MissioFrame } from "@/components/missio/shell";
import { missioBody, missioDisplay, missioMono } from "@/components/missio/fonts";
import { MissioOrgRoot } from "@/components/missio/org-root";

export const metadata: Metadata = {
  title: { absolute: "Missio" },
};

export default function MissioLayout({ children }: { children: React.ReactNode }) {
  return (
    // theme-light: Missio has its own skin and stays light in Hub dark mode.
    // It also re-pins the Hub tokens (--ink, --surface-1 …) that Missio
    // surfaces fall back to, and keeps native controls light.
    <div data-missio-font="" className={`theme-light ${missioBody.variable} ${missioDisplay.variable} ${missioMono.variable} ${missioBody.className}`}>
      <MissioOrgRoot />
      <MissioFrame>{children}</MissioFrame>
    </div>
  );
}
