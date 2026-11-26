"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";
import pw from "@/components/song-library/pw.module.css";
import sw from "./sw.module.css";
import { trainingHref } from "./header";
import { PenIcon } from "./icons";
import {
  applyFilter,
  countText,
  filterChips,
  groupByMonth,
  isTentativeTraining,
  trainingSubline,
  trainingTitle,
  type TrainingFilter,
} from "./trainings";
import type { SongwritingData } from "./types";
import { useSongwriting } from "./use-songwriting";

/** Cards shown before "N earlier trainings". */
const FIRST_PAGE = 12;

export function TrainingsView({ slug, initial }: { slug: string; initial?: SongwritingData }) {
  const { loading, data } = useSongwriting(slug, initial);
  const [filterKey, setFilterKey] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const nationById = useMemo(() => new Map(data.nations.map((n) => [n.id, n])), [data.nations]);
  const chips = filterChips(data.trainings, nationById);
  const active: TrainingFilter = chips.find((c) => c.key === filterKey)?.filter ?? { kind: "all" };
  const filtered = applyFilter(data.trainings, active, nationById);
  const groups = groupByMonth(filtered);

  let shown = 0;
  const visibleGroups = groups
    .map((g) => {
      if (showAll) return g;
      const room = Math.max(0, FIRST_PAGE - shown);
      const trainings = g.trainings.slice(0, room);
      shown += trainings.length;
      return { ...g, trainings };
    })
    .filter((g) => g.trainings.length > 0);
  const hidden = showAll ? 0 : Math.max(0, filtered.length - FIRST_PAGE);

  return (
    <div aria-busy={loading || undefined}>
      <div className={`${pw.pad} ${pw.ruled}`}>
        <Link className={`${pw.btn} ${pw.primary} ${pw.block}`} href={trainingHref(slug, "new")}>
          + Add training
        </Link>
      </div>
      {data.trainings.length > 0 ? (
        <div className={sw.filters} role="group" aria-label="Filter trainings">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={sw.filter}
              aria-pressed={chip.key === filterKey}
              onClick={() => {
                setFilterKey(chip.key);
                setShowAll(false);
              }}
            >
              {chip.label} · {chip.count}
            </button>
          ))}
        </div>
      ) : null}

      {data.trainings.length === 0 ? (
        <div className={pw.empty}>
          <div className={pw.emptyTitle}>{loading ? "Loading…" : "No trainings yet"}</div>
          {loading ? null : <p className={pw.emptyText}>Add a songwriting training to start counting nations, people and songs.</p>}
        </div>
      ) : null}

      {visibleGroups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className={pw.mgroup}>{group.label}</div>
          {group.trainings.map((t) => (
            <TrainingCard key={t.id} slug={slug} training={t} nation={t.nation_id ? nationById.get(t.nation_id) : undefined} />
          ))}
        </section>
      ))}

      {hidden > 0 ? (
        <button type="button" className={pw.more} onClick={() => setShowAll(true)}>
          <span>
            {hidden} earlier {hidden === 1 ? "training" : "trainings"}
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </div>
  );
}

export function TrainingCard({
  slug,
  training,
  nation,
}: {
  slug: string;
  training: PwSongwritingTraining;
  nation: PwNation | undefined;
}) {
  const tentative = isTentativeTraining(training, nation);
  const title = trainingTitle(training);
  return (
    <article className={`${sw.card} ${tentative ? sw.tent : ""}`}>
      <div className={sw.top}>
        <div className={pw.what}>
          <h3 className={sw.cardTitle}>{title}</h3>
          <div className={sw.cardSub}>{trainingSubline(training, nation)}</div>
        </div>
        {tentative ? <span className={`${pw.pill} ${pw.pillDash}`}>Tentative</span> : null}
        <Link className={sw.editbtn} href={trainingHref(slug, training.id)} aria-label={`Edit ${title}`}>
          <PenIcon />
        </Link>
      </div>
      <div className={sw.nums}>
        <div>
          <div className={sw.num}>{countText(training.people_trained)}</div>
          <div className={sw.numLabel}>Trained</div>
        </div>
        <div>
          <div className={sw.num}>{countText(training.songs_workshop)}</div>
          <div className={sw.numLabel}>Songs</div>
        </div>
        <div>
          <div className={sw.num}>{countText(training.songs_post)}</div>
          <div className={sw.numLabel}>After</div>
        </div>
      </div>
      {training.languages.length > 0 ? (
        <div className={sw.tags} aria-label="Languages">
          {training.languages.map((lang) => (
            <span key={lang} className={pw.chip}>
              {lang}
            </span>
          ))}
        </div>
      ) : null}
      {training.notes ? <p className={sw.note}>{training.notes}</p> : null}
    </article>
  );
}
