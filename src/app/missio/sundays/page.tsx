import type { Metadata } from "next";
import { MissioSundays } from "@/components/missio/sundays";

export const metadata: Metadata = {
  title: { absolute: "Sundays · Missio" },
};

export default function MissioSundaysPage() {
  return <MissioSundays />;
}
