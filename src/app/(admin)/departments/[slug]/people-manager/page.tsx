import type { Metadata } from "next";
import { redirect } from "next/navigation";
import pw from "@/components/song-library/pw.module.css";
import { pmPaths } from "@/components/departments/people-manager/client";
import { Dashboard } from "@/components/departments/people-manager/dashboard";
import { PmHeader } from "@/components/departments/people-manager/header";
import { firstParam, loadPmContext, pmPagePath } from "./_lib/context";

export const metadata: Metadata = { title: "People Manager" };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Leaders and admins: the queue, who's away, days used. Everyone else: their own time off. */
export default async function PeopleManagerPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Search }) {
  const { slug } = await params;
  const focus = firstParam((await searchParams).request);
  const ctx = await loadPmContext(slug, pmPagePath(slug, focus ? `?request=${focus}` : ""));
  if (!ctx.canManage) redirect(focus ? pmPaths(ctx.slug).mineFocus(focus) : pmPaths(ctx.slug).mine);
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader {...ctx} active="manager" />
      <Dashboard slug={ctx.slug} focusRequestId={focus} />
    </div>
  );
}
