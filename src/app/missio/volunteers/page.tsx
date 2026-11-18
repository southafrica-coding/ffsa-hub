import type { Metadata } from "next";
import { VolunteersBoard } from "@/components/missio/availability/volunteers-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Volunteers · Missio" },
};

export default function MissioVolunteersPage() {
  return <VolunteersBoard />;
}
