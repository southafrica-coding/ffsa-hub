import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { NationsView } from "@/components/departments/songwriting/nations-view";
import { loadSongwritingContext, pathFor } from "../_lib/context";

export const metadata: Metadata = { title: "Nations · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingNationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/nations"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader slug={ctx.slug} departmentName={ctx.departmentName} active="nations" band="edit" />
      <NationsView slug={ctx.slug} />
    </div>
  );
}
