import type { Metadata } from "next";
import pw from "@/components/song-library/pw.module.css";
import { PmHeader } from "@/components/departments/people-manager/header";
import { MyTimeOff } from "@/components/departments/people-manager/my-time-off";
import { firstParam, loadPmContext, pmPagePath } from "../_lib/context";

export const metadata: Metadata = { title: "My time off" };
export const dynamic = "force-dynamic";

export default async function MyTimeOffPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const focus = firstParam((await searchParams).request);
  const ctx = await loadPmContext(slug, pmPagePath(slug, `/mine${focus ? `?request=${focus}` : ""}`));
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <PmHeader {...ctx} active="mine" />
      <MyTimeOff slug={ctx.slug} focusRequestId={focus} />
    </div>
  );
}
