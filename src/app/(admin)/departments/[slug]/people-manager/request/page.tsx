import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { PmHeader } from "@/components/departments/people-manager/header";
import { RequestForm } from "@/components/departments/people-manager/request-form";
import { loadPmContext, pmPagePath } from "../_lib/context";

export const metadata: Metadata = { title: "Request time off" };
export const dynamic = "force-dynamic";

export default async function RequestTimeOffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadPmContext(slug, pmPagePath(slug, "/request"));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader {...ctx} active="mine" />
      <RequestForm slug={ctx.slug} />
    </div>
  );
}
