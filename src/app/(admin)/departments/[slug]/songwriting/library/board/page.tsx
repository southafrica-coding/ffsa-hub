import type { Metadata } from "next";
import { BoardView } from "@/components/song-library/board-view";
import { loadSongwritingContext, pathFor } from "../../_lib/context";
import { LibraryFrame } from "../_frame";

export const metadata: Metadata = { title: "Lead board · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/library/board"));
  return (
    <LibraryFrame ctx={ctx} sub>
      <BoardView scope={{ kind: "department", slug: ctx.slug }} ownerName={ctx.departmentName} />
    </LibraryFrame>
  );
}
