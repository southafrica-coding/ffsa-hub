import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { TrainingForm } from "@/components/departments/songwriting/training-form";
import { loadSongwritingContext, pathFor } from "../../_lib/context";

export const metadata: Metadata = { title: "Add training · Songwriting" };
export const dynamic = "force-dynamic";

export default async function NewTrainingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/trainings/new"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader slug={ctx.slug} departmentName={ctx.departmentName} active="trainings" band="edit" />
      <TrainingForm slug={ctx.slug} trainingId={null} />
    </div>
  );
}
