import type { Metadata } from "next";
import { HouseDetailView } from "@/components/missio/house-churches/house-detail";

export const metadata: Metadata = {
  title: { absolute: "House church · Missio" },
};

export default async function MissioHouseChurchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HouseDetailView houseId={id} />;
}
