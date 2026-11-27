import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader, songwritingHref } from "@/components/departments/songwriting/header";
import { LeadView } from "@/components/departments/songwriting/lead-view";
import { loadSongwritingContext, pathFor } from "../../_lib/context";

export const metadata: Metadata = { title: "Lead · Songwriting" };
export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ slug: string; leadId: string }> }) {
  const { slug, leadId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/follow-up/${encodeURIComponent(leadId)}`));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="follow-up"
        band="edit"
        back={{ href: songwritingHref(ctx.slug, "follow-up"), label: "Follow-up" }}
      />
      <LeadView slug={ctx.slug} leadId={leadId} />
    </div>
  );
}
