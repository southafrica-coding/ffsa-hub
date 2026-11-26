import type { Metadata } from "next";
import { PersonProfileView } from "@/components/missio/person-profile";

export const metadata: Metadata = {
  title: { absolute: "Person · Missio" },
};

export default async function MissioPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonProfileView personId={id} />;
}
