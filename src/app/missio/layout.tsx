import type { Metadata } from "next";
import { MissioFrame } from "@/components/missio/shell";
import { missioBody, missioDisplay } from "@/components/missio/fonts";

export const metadata: Metadata = {
  title: { absolute: "Missio" },
};

export default function MissioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-missio-font="" className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className}`}>
      <MissioFrame>{children}</MissioFrame>
    </div>
  );
}
