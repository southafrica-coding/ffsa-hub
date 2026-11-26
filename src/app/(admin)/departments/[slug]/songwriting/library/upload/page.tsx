import type { Metadata } from "next";
import { UploadForm } from "@/components/song-library/upload-form";
import { loadSongwritingContext, pathFor } from "../../_lib/context";
import { LibraryFrame } from "../_frame";

export const metadata: Metadata = { title: "Upload a song · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingUploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const source = typeof search.source_training_id === "string" && search.source_training_id ? search.source_training_id : null;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/library/upload"));
  return (
    <LibraryFrame ctx={ctx} sub>
      <UploadForm scope={{ kind: "department", slug: ctx.slug }} sourceTrainingId={source} />
    </LibraryFrame>
  );
}
