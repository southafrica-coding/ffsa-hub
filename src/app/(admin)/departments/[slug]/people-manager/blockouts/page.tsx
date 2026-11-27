import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { BlockoutsEditor } from "@/components/departments/people-manager/blockouts-editor";
import { PmHeader } from "@/components/departments/people-manager/header";
import { loadPmContext, pmPagePath } from "../_lib/context";

export const metadata: Metadata = { title: "Block out dates" };
export const dynamic = "force-dynamic";

export default async function BlockoutsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadPmContext(slug, pmPagePath(slug, "/blockouts"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader {...ctx} active={ctx.canRequest ? "mine" : "manager"} />
      <BlockoutsEditor slug={ctx.slug} />
    </div>
  );
}
