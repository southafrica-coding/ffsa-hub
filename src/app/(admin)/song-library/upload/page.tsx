import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { UploadForm } from "@/components/song-library/upload-form";
import { loadLibraryViewer } from "../_lib/viewer";

export const metadata: Metadata = { title: "Upload a song · Song Library" };
export const dynamic = "force-dynamic";

export default async function SongLibraryUploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const source = typeof search.source_training_id === "string" && search.source_training_id ? search.source_training_id : null;
  const viewer = await loadLibraryViewer("/song-library/upload");
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} sub />
      <UploadForm scope={{ kind: "service" }} sourceTrainingId={source} />
    </div>
  );
}
