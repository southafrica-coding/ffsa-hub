import type { Metadata } from "next";
import { Suspense } from "react";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader, songwritingHref } from "@/components/departments/songwriting/header";
import { LeadForm } from "@/components/departments/songwriting/lead-form";
import { loadSongwritingContext, pathFor } from "../../_lib/context";

export const metadata: Metadata = { title: "Add lead · Songwriting" };
export const dynamic = "force-dynamic";

export default async function NewLeadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, "/follow-up/new"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="follow-up"
        band="edit"
        back={{ href: songwritingHref(ctx.slug, "follow-up"), label: "Follow-up" }}
      />
      <Suspense fallback={<p className={pw.hint}>Loading…</p>}>
        <LeadForm slug={ctx.slug} leadId={null} />
      </Suspense>
    </div>
  );
}
