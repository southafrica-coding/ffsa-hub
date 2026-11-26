import type { Metadata } from "next";
import { HelpersView } from "@/components/song-library/helpers-view";
import { loadSongwritingContext, pathFor } from "../../_lib/context";
import { LibraryFrame } from "../_frame";

export const metadata: Metadata = { title: "Helpers · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingHelpersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/library/helpers"));
  return (
    <LibraryFrame ctx={ctx} sub>
      <HelpersView scope={{ kind: "department", slug: ctx.slug }} />
    </LibraryFrame>
  );
}
