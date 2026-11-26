import type { Metadata } from "next";
import { HouseChurchGrid } from "@/components/missio/house-churches/house-grid";

export const metadata: Metadata = {
  title: { absolute: "House churches · Missio" },
};

export default function MissioHouseChurchesPage() {
  return <HouseChurchGrid />;
}
