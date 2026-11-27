import type { Metadata } from "next";
import { notFound } from "next/navigation";
import pw from "@/components/song-library/pw.module.css";
import { pmPaths } from "@/components/departments/people-manager/client";
import { PmHeader } from "@/components/departments/people-manager/header";
import { SettingsView } from "@/components/departments/people-manager/settings-view";
import { loadPmContext, pmPagePath } from "../_lib/context";

export const metadata: Metadata = { title: "Leave guidelines" };
export const dynamic = "force-dynamic";

/** Read only: there is no write API for leave types or guidelines yet. */
export default async function LeaveGuidelinesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadPmContext(slug, pmPagePath(slug, "/settings"));
  if (!ctx.canManage) notFound();
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader
        {...ctx}
        active={null}
        back={{ href: pmPaths(ctx.slug).home, label: "People Manager" }}
        eyebrow={`${ctx.departmentName} · People Manager`}
        title="Leave guidelines"
      />
      <SettingsView slug={ctx.slug} />
    </div>
  );
}
