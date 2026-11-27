import type { Metadata } from "next";
import { notFound } from "next/navigation";
import pw from "@/components/song-library/pw.module.css";
import { isUuid } from "@/lib/departments/validate";
import { PmHeader } from "@/components/departments/people-manager/header";
import { PersonView } from "@/components/departments/people-manager/person-view";
import { loadPmContext, pmPagePath } from "../../_lib/context";

export const metadata: Metadata = { title: "Person · People Manager" };
export const dynamic = "force-dynamic";

/** A person's year. Leaders and admins for anyone in the department; anyone for themselves. */
export default async function PersonYearPage({ params }: { params: Promise<{ slug: string; userId: string }> }) {
  const { slug, userId } = await params;
  if (!isUuid(userId)) notFound();
  const ctx = await loadPmContext(slug, pmPagePath(slug, `/people/${userId}`));
  if (!ctx.canManage && userId !== ctx.userId) notFound();
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader {...ctx} active={ctx.canManage ? "manager" : "mine"} />
      <PersonView slug={ctx.slug} userId={userId} />
    </div>
  );
}
