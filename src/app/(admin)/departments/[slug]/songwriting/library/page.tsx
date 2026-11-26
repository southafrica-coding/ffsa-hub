import type { Metadata } from "next";
import { LibraryHome } from "@/components/song-library/library-home";
import { loadSongwritingContext, pathFor } from "../_lib/context";
import { LibraryFrame } from "./_frame";

export const metadata: Metadata = { title: "Library · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingLibraryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/library"));
  // Everyone who reaches Songwriting is in the owning department, so may move stage and placement.
  return (
    <LibraryFrame ctx={ctx}>
      <LibraryHome scope={{ kind: "department", slug: ctx.slug }} canManage />
    </LibraryFrame>
  );
}
