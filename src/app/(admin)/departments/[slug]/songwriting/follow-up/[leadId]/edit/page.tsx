import type { Metadata } from "next";
import { Suspense } from "react";
import pw from "@/components/song-library/pw.module.css";
import { leadHref, SongwritingHeader } from "@/components/departments/songwriting/header";
import { LeadForm } from "@/components/departments/songwriting/lead-form";
import { loadSongwritingContext, pathFor } from "../../../_lib/context";

export const metadata: Metadata = { title: "Edit lead · Songwriting" };
export const dynamic = "force-dynamic";

export default async function EditLeadPage({ params }: { params: Promise<{ slug: string; leadId: string }> }) {
  const { slug, leadId } = await params;
  const ctx = await loadSongwritingContext(slug, pathFor(slug, `/follow-up/${encodeURIComponent(leadId)}/edit`));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="follow-up"
        band="edit"
        back={{ href: leadHref(ctx.slug, leadId), label: "Lead" }}
      />
      <Suspense fallback={<p className={pw.hint}>Loading…</p>}>
        <LeadForm slug={ctx.slug} leadId={leadId} />
      </Suspense>
    </div>
  );
}
