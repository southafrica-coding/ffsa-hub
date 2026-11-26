import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { FollowUpView } from "@/components/departments/songwriting/followup-view";
import { departmentLibraryPaths } from "@/components/song-library/paths";
import { loadSongwritingContext, pathFor } from "../_lib/context";

export const metadata: Metadata = { title: "Follow-up · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingFollowUpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/follow-up"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader slug={ctx.slug} departmentName={ctx.departmentName} active="follow-up" band="edit" />
      <FollowUpView slug={ctx.slug} uploadHref={departmentLibraryPaths(ctx.slug).upload()} />
    </div>
  );
}
