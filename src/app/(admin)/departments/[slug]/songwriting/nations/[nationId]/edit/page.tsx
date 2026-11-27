import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { nationHref, SongwritingHeader } from "@/components/departments/songwriting/header";
import { NationForm } from "@/components/departments/songwriting/nation-form";
import { loadSongwritingContext, pathFor } from "../../../_lib/context";

export const metadata: Metadata = { title: "Edit nation · Songwriting" };
export const dynamic = "force-dynamic";

export default async function EditNationPage({ params }: { params: Promise<{ slug: string; nationId: string }> }) {
  const { slug, nationId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/nations/${encodeURIComponent(nationId)}/edit`));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="nations"
        band="edit"
        back={{ href: nationHref(ctx.slug, nationId), label: "Nation" }}
      />
      <NationForm slug={ctx.slug} nationId={nationId} />
    </div>
  );
}
