import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { LibraryHome } from "@/components/song-library/library-home";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { loadLibraryViewerForIndex } from "../_lib/viewer";

export const metadata: Metadata = { title: "Song Library" };
export const dynamic = "force-dynamic";

/**
 * The library home sits under its own loading boundary, so it never 404s:
 * a signed-out viewer goes to login and an inactive account sees nothing
 * (the same as /services). The other library routes live outside this
 * group and may 404.
 */
export default async function SongLibraryPage() {
  const viewer = await loadLibraryViewerForIndex("/song-library");
  if (!viewer) return null;
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} />
      <LibraryHome scope={{ kind: "service" }} canManage={viewer.canManage} />
    </div>
  );
}
