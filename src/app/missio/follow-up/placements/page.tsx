import type { Metadata } from "next";
import { PlacementTracker } from "@/components/missio/placements/tracker";

export const metadata: Metadata = {
  title: { absolute: "Placements · Missio" },
};

export default function MissioPlacementsPage() {
  return <PlacementTracker />;
}
