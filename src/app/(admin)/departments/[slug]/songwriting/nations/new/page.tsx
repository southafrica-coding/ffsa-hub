import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader, songwritingHref } from "@/components/departments/songwriting/header";
import { NationForm } from "@/components/departments/songwriting/nation-form";
import { loadSongwritingContext, pathFor } from "../../_lib/context";

export const metadata: Metadata = { title: "Add nation · Songwriting" };
export const dynamic = "force-dynamic";

export default async function NewNationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/nations/new"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="nations"
        band="edit"
        back={{ href: songwritingHref(ctx.slug, "nations"), label: "Nations" }}
      />
      <NationForm slug={ctx.slug} nationId={null} />
    </div>
  );
}
