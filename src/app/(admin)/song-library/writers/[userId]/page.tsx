import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { WriterProfile } from "@/components/song-library/writer-profile";
import { loadLibraryViewer } from "../../_lib/viewer";

export const metadata: Metadata = { title: "Writer · Song Library" };
export const dynamic = "force-dynamic";

export default async function SongLibraryWriterPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const viewer = await loadLibraryViewer(`/song-library/writers/${encodeURIComponent(userId)}`);
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} sub />
      <WriterProfile scope={{ kind: "service" }} userId={userId} />
    </div>
  );
}
