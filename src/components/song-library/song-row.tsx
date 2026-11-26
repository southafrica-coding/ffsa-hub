import Link from "next/link";
import { PlayIcon } from "@/components/departments/songwriting/icons";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { activityLine } from "./format";
import { isFinished, needsDemo, PLACEMENT_LABEL, STAGE_LABEL } from "./stages";
import { stuckInfo } from "./stuck";
import type { SongListItem, SongStage } from "./types";

export function StageTag({ stage }: { stage: SongStage }) {
  const tone = isFinished(stage) ? sl.stageFin : needsDemo(stage) ? sl.stageDemo : "";
  return <span className={`${sl.stage} ${tone}`}>{STAGE_LABEL[stage]}</span>;
}

/** One song in a list. `subline` overrides the writers line (writer page: "with …"). */
export function SongRow({
  item,
  href,
  now,
  subline,
}: {
  item: SongListItem;
  href: string;
  now: Date;
  subline?: string;
}) {
  const { song } = item;
  const info = stuckInfo(song.stage, song.last_activity_at, now, item.status);
  const uploaded = song.stage === "idea_entry" && song.last_activity_at === song.created_at;
  return (
    <Link className={sl.songrow} href={href}>
      <span className={sl.play} aria-hidden="true">
        <PlayIcon />
      </span>
      <div className={pw.what}>
        <h3 className={sl.songTitle}>{song.title}</h3>
        <div className={pw.s}>{subline ?? (item.writers.map((w) => w.name).join(" · ") || "Writer not named")}</div>
        <div className={sl.tags}>
          <StageTag stage={song.stage} />
          <span className={sl.place}>{PLACEMENT_LABEL[song.placement]}</span>
          {info.stuck ? <span className={sl.stuck}>Stuck · {info.days}d</span> : null}
        </div>
        <div className={sl.when}>{activityLine({ days: info.days, stuck: info.stuck, stage: song.stage, uploaded })}</div>
      </div>
    </Link>
  );
}
