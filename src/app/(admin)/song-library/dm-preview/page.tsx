import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { DmPreview } from "@/components/song-library/dm-preview";
import { SERVICE_LIBRARY_PATHS } from "@/components/song-library/paths";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { loadLibraryViewer } from "../_lib/viewer";

export const metadata: Metadata = { title: "Slack DM preview · Song Library" };
export const dynamic = "force-dynamic";

export default async function SongLibraryDmPreviewPage() {
  const viewer = await loadLibraryViewer("/song-library/dm-preview");
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} sub />
      <DmPreview paths={{ home: SERVICE_LIBRARY_PATHS.home, helpers: SERVICE_LIBRARY_PATHS.helpers }} />
    </div>
  );
}
