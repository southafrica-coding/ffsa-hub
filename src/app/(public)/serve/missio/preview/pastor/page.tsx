import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { missioSkinVars } from "@/components/missio/access";
import { VolunteersBoard } from "@/components/missio/availability/volunteers-board";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import { pastorGridFixture } from "@/lib/missio/availability/fixtures";
import shell from "@/components/missio/shell.module.css";

export const dynamic = "force-dynamic";

const skin = missioSkinVars() as CSSProperties;

export default function PastorGridPreviewPage() {
  if (process.env.MISSIO_SCREENSHOTS !== "1") notFound();
  return (
    <div
      className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${shell.shell}`}
      data-missio-shell=""
      data-skin="missio"
      style={skin}
    >
      <div className={shell.main}>
        <div className={shell.top}>
          <span className={shell.crumb}>
            Missio / <b>Volunteers</b>
          </span>
        </div>
        <div className={shell.content} data-missio-content="">
          <VolunteersBoard initial={pastorGridFixture()} live={false} />
        </div>
      </div>
    </div>
  );
}
