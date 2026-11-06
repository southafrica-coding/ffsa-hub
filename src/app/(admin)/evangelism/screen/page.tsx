import type { Metadata } from "next";
import { requireEvangelismPage } from "../access";
import { TvScreen } from "../tv-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evangelism screen" };

export default async function EvangelismScreenPage() {
  await requireEvangelismPage();
  return <TvScreen />;
}
