import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { TrainingsView } from "@/components/departments/songwriting/trainings-view";
import { loadSongwritingContext, pathFor } from "../_lib/context";

export const metadata: Metadata = { title: "Trainings · Songwriting" };
export const dynamic = "force-dynamic";

export default async function SongwritingTrainingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/trainings"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader slug={ctx.slug} departmentName={ctx.departmentName} active="trainings" band="edit" />
      <TrainingsView slug={ctx.slug} />
    </div>
  );
}
