import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { OverviewView } from "@/components/departments/songwriting/overview-view";
import { departmentLibraryPaths } from "@/components/song-library/paths";
import { loadSongwritingContext, pathFor } from "./_lib/context";

export const metadata: Metadata = { title: "Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader slug={ctx.slug} departmentName={ctx.departmentName} active="overview" band="edit" />
      <OverviewView slug={ctx.slug} uploadHref={departmentLibraryPaths(ctx.slug).upload()} />
    </div>
  );
}
