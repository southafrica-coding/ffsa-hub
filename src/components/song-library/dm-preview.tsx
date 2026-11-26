import Link from "next/link";
import type { ReactNode } from "react";
import { PlayIcon } from "@/components/departments/songwriting/icons";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import type { LibraryPaths } from "./paths";

/**
 * A preview of the three Slack DMs. Nothing is sent from here: this page
 * shows the copy so it can be reviewed. Example names only.
 */
export function DmPreview({ paths }: { paths: Pick<LibraryPaths, "home" | "helpers"> }) {
  return (
    <>
      <div className={sl.mocklabel}>Preview of the Slack DMs. Generic layout, not Slack&apos;s own look. Nothing is sent from this page.</div>
      <div className={sl.dmhead}>
        <span className={sl.botav} aria-hidden="true">
          FF
        </span>
        <div>
          <div className={pw.k}>FFSA Hub Activity</div>
          <div className={pw.s} style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            Direct message · app
          </div>
        </div>
      </div>
      <div className={sl.dmwrap}>
        <div className={sl.daysep}>Example</div>
        <Dm time="09:12">
          <div className={sl.bubbleH}>🎵 Dani Blood uploaded a new song</div>
          <div className={sl.bubbleP}>“Harbour Lights” · started with Melody · Idea / Entry</div>
          <div className={sl.bubbleP} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--rule)", padding: 8, background: "var(--surface-2)", marginTop: 10 }}>
            <span className={sl.play} style={{ width: 36, height: 36 }} aria-hidden="true">
              <PlayIcon />
            </span>
            <span>verse-and-chorus-idea.mp3 · 1:42</span>
          </div>
          <Buttons primary="Listen in Hub" href={paths.home} secondary="Unsubscribe" />
          <div className={sl.why}>You get this because you subscribe to Dani Blood.</div>
        </Dm>
        <Dm time="11:40">
          <div className={sl.bubbleH}>“Mercy Like Morning” is Demo ready</div>
          <div className={sl.bubbleP}>Moved from Written, needs demo. Placement: Ministry Nights.</div>
          <Buttons primary="Hear the demo" href={paths.home} secondary="Unsubscribe" />
          <div className={sl.why}>You get this because you follow all uploads.</div>
        </Dm>
        <Dm time="14:05" help>
          <div className={sl.bubbleH}>Kiri asked for help: bass and drums</div>
          <div className={sl.bubbleP}>For the demo of “Lanterns in the Valley”.</div>
          <Buttons primary="I can help" href={paths.helpers} secondary="Unsubscribe" />
          <div className={sl.why}>You get this because you signed up to help with Bass.</div>
        </Dm>
      </div>
      <p className={pw.hint}>Names and songs above are examples.</p>
    </>
  );
}

function Dm({ time, help, children }: { time: string; help?: boolean; children: ReactNode }) {
  return (
    <div className={sl.dm}>
      <span className={sl.botav} aria-hidden="true">
        FF
      </span>
      <div className={pw.what}>
        <div className={sl.dmName}>
          FFSA Hub Activity<span className={sl.dmTime}>{time}</span>
        </div>
        <div className={`${sl.bubble} ${help ? sl.bubbleHelp : ""}`}>{children}</div>
      </div>
    </div>
  );
}

function Buttons({ primary, href, secondary }: { primary: string; href: string; secondary: string }) {
  return (
    <div className={pw.btnrow} style={{ marginTop: 10 }}>
      <Link className={`${pw.btn} ${pw.primary} ${pw.grow}`} href={href}>
        {primary}
      </Link>
      <span className={`${pw.btn} ${pw.grow}`} aria-disabled="true">
        {secondary}
      </span>
    </div>
  );
}
