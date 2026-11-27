import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { pmPaths } from "@/components/departments/people-manager/client";
import { DmPreview } from "@/components/departments/people-manager/dm-preview";
import { PmHeader } from "@/components/departments/people-manager/header";
import { loadPmContext, pmPagePath } from "../_lib/context";

export const metadata: Metadata = { title: "Slack DM preview" };
export const dynamic = "force-dynamic";

/** What the leave DMs say. Example names; nothing is sent from this page. */
export default async function DmPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadPmContext(slug, pmPagePath(slug, "/dm-preview"));
  const paths = pmPaths(ctx.slug);
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader
        {...ctx}
        active={null}
        back={ctx.canManage ? { href: paths.home, label: "People Manager" } : { href: paths.mine, label: "My time off" }}
        eyebrow="People Manager · Slack"
        title="DM preview"
      />
      <DmPreview slug={ctx.slug} departmentName={ctx.departmentName} />
    </div>
  );
}
