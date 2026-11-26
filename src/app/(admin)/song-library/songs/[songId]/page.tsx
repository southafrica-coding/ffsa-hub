import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { SongDetail } from "@/components/song-library/song-detail";
import { loadLibraryViewer } from "../../_lib/viewer";

export const metadata: Metadata = { title: "Song · Song Library" };
export const dynamic = "force-dynamic";

export default async function SongLibrarySongPage({ params }: { params: Promise<{ songId: string }> }) {
  const { songId } = await params;
  const viewer = await loadLibraryViewer(`/song-library/songs/${encodeURIComponent(songId)}`);
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} sub />
      <SongDetail scope={{ kind: "service" }} songId={songId} canManage={viewer.canManage} ownerName={viewer.ownerName} />
    </div>
  );
}
