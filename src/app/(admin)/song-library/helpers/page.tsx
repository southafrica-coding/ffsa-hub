import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { HelpersView } from "@/components/song-library/helpers-view";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { loadLibraryViewer } from "../_lib/viewer";

export const metadata: Metadata = { title: "Helpers · Song Library" };
export const dynamic = "force-dynamic";

export default async function SongLibraryHelpersPage() {
  const viewer = await loadLibraryViewer("/song-library/helpers");
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} sub />
      <HelpersView scope={{ kind: "service" }} />
    </div>
  );
}
