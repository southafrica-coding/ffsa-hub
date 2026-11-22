import type { Metadata } from "next";
import { MissioFrame } from "@/components/missio/shell";
import { missioBody, missioDisplay } from "@/components/missio/fonts";

export const metadata: Metadata = {
  title: { absolute: "Missio" },
};

export default function MissioLayout({ children }: { children: React.ReactNode }) {
  return (
    // theme-light: Missio has its own skin and stays light in Hub dark mode.
    // It also re-pins the Hub tokens (--ink, --surface-1 …) that Missio
    // surfaces fall back to, and keeps native controls light.
    <div data-missio-font="" className={`theme-light ${missioBody.variable} ${missioDisplay.variable} ${missioBody.className}`}>
      <MissioFrame>{children}</MissioFrame>
    </div>
  );
}
