import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { TrainingForm } from "@/components/departments/songwriting/training-form";
import { loadSongwritingContext, pathFor } from "../../_lib/context";

export const metadata: Metadata = { title: "Edit training · Songwriting" };
export const dynamic = "force-dynamic";

export default async function EditTrainingPage({ params }: { params: Promise<{ slug: string; trainingId: string }> }) {
  const { slug, trainingId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/trainings/${encodeURIComponent(trainingId)}`));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader slug={ctx.slug} departmentName={ctx.departmentName} active="trainings" band="edit" />
      <TrainingForm slug={ctx.slug} trainingId={trainingId} />
    </div>
  );
}
