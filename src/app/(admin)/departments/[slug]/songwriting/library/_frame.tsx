import type { ReactNode } from "react";
import pw from "@/components/song-library/pw.module.css";
import { SongwritingHeader } from "@/components/departments/songwriting/header";
import { departmentLibraryPaths } from "@/components/song-library/paths";
import type { SongwritingContext } from "../_lib/context";

/** The Library tab: Songwriting subnav plus the Hub Service band. Sub-pages go back to the library. */
export function LibraryFrame({ ctx, sub, children }: { ctx: SongwritingContext; sub?: boolean; children: ReactNode }) {
  return (
    <div className={`ffsa-screen ${pw.page}`}>
      <SongwritingHeader
        slug={ctx.slug}
        departmentName={ctx.departmentName}
        active="library"
        band="service"
        back={sub ? { href: departmentLibraryPaths(ctx.slug).home, label: "Library" } : undefined}
      />
      {children}
    </div>
  );
}
