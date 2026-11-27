import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader, songwritingHref } from "@/components/departments/songwriting/header";
import { NationView } from "@/components/departments/songwriting/nation-view";
import { loadSongwritingContext, pathFor } from "../../_lib/context";

export const metadata: Metadata = { title: "Nation · Songwriting" };
export const dynamic = "force-dynamic";

export default async function NationPage({ params }: { params: Promise<{ slug: string; nationId: string }> }) {
  const { slug, nationId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/nations/${encodeURIComponent(nationId)}`));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="nations"
        band="edit"
        back={{ href: songwritingHref(ctx.slug, "nations"), label: "Nations" }}
      />
      <NationView slug={ctx.slug} nationId={nationId} />
    </div>
  );
}
