import type { Metadata } from "next";
import { CareBoard } from "@/components/missio/care/board";

export const metadata: Metadata = {
  title: { absolute: "Care · Missio" },
};

export default function MissioCarePage() {
  return <CareBoard />;
}
