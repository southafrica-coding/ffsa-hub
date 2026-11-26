import type { Metadata } from "next";
import { DmPreview } from "@/components/song-library/dm-preview";
import { departmentLibraryPaths } from "@/components/song-library/paths";
import { loadSongwritingContext, pathFor } from "../../_lib/context";
import { LibraryFrame } from "../_frame";

export const metadata: Metadata = { title: "Slack DM preview · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingDmPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/library/dm-preview"));
  const paths = departmentLibraryPaths(ctx.slug);
  return (
    <LibraryFrame ctx={ctx} sub>
      <DmPreview paths={{ home: paths.home, helpers: paths.helpers }} />
    </LibraryFrame>
  );
}
