import type { Metadata } from "next";
import { WriterProfile } from "@/components/song-library/writer-profile";
import { loadSongwritingContext, pathFor } from "../../../_lib/context";
import { LibraryFrame } from "../../_frame";

export const metadata: Metadata = { title: "Writer · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingWriterPage({ params }: { params: Promise<{ slug: string; userId: string }> }) {
  const { slug, userId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/library/writers/${encodeURIComponent(userId)}`));
  return (
    <LibraryFrame ctx={ctx} sub>
      <WriterProfile scope={{ kind: "department", slug: ctx.slug }} userId={userId} />
    </LibraryFrame>
  );
}
