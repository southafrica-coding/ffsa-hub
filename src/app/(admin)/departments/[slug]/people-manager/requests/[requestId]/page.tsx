import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import pw from "@/components/song-library/pw.module.css";
import { pmPaths } from "@/components/departments/people-manager/client";
import { PmHeader } from "@/components/departments/people-manager/header";
import { RequestDetail } from "@/components/departments/people-manager/request-detail";
import { firstParam, loadPmContext, pmPagePath } from "../../_lib/context";

export const metadata: Metadata = { title: "Leave request" };
export const dynamic = "force-dynamic";

/** One request, for links from Slack or elsewhere. The API decides who can see it. */
export default async function LeaveRequestPage({ params }: { params: Promise<{ slug: string; requestId: string }> }) {
  const { slug, requestId } = await params;
  const id = firstParam(requestId);
  if (!id) notFound();
  const ctx = await loadPmContext(slug, pmPagePath(slug, `/requests/${id}`));
  const paths = pmPaths(ctx.slug);
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader {...ctx} active={ctx.canManage ? "manager" : "mine"} />
      <RequestDetail slug={ctx.slug} requestId={id} viewerId={ctx.userId} />
      <Link className={pw.more} href={ctx.canManage ? paths.home : paths.mine}>
        <span>{ctx.canManage ? "Back to the People Manager" : "Back to my time off"}</span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
