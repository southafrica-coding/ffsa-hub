import type { Metadata } from "next";
import { SongDetail } from "@/components/song-library/song-detail";
import { loadSongwritingContext, pathFor } from "../../../_lib/context";
import { LibraryFrame } from "../../_frame";

export const metadata: Metadata = { title: "Song · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingSongPage({ params }: { params: Promise<{ slug: string; songId: string }> }) {
  const { slug, songId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/library/songs/${encodeURIComponent(songId)}`));
  return (
    <LibraryFrame ctx={ctx} sub>
      <SongDetail scope={{ kind: "department", slug: ctx.slug }} songId={songId} canManage ownerName={ctx.departmentName} />
    </LibraryFrame>
  );
}
