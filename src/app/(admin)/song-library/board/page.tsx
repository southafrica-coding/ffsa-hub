import type { Metadata } from "next";
import { notFound } from "next/navigation";
import pw from "@/components/song-library/pw.module.css";
import { BoardView } from "@/components/song-library/board-view";
import { ServiceLibraryHeader } from "@/components/song-library/service-header";
import { loadLibraryViewer } from "../_lib/viewer";

export const metadata: Metadata = { title: "Lead board · Song Library" };
export const dynamic = "force-dynamic";

export default async function SongLibraryBoardPage() {
  const viewer = await loadLibraryViewer("/song-library/board");
  if (!viewer.canManage) notFound();
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <ServiceLibraryHeader ownerName={viewer.ownerName} sub />
      <BoardView scope={{ kind: "service" }} ownerName={viewer.ownerName} />
    </div>
  );
}
