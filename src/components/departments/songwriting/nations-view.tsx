"use client";

import Link from "next/link";
import pw from "@/components/song-library/pw.module.css";
import sw from "./sw.module.css";
import { nationHref, trainingHref } from "./header";
import { canEdit } from "./permissions";
import { nationCode, plural, summariseNations, trainedText, type NationSummary } from "./nations";
import { monthLabel, reachedPercent, WORLD_NATIONS } from "./overview";
import { trainingTitle } from "./trainings";
import type { SongwritingData } from "./types";
import { NoAccessNote } from "@/components/song-library/no-access";
import { useSongwriting } from "./use-songwriting";

export function NationsView({ slug, initial }: { slug: string; initial?: SongwritingData }) {
  const { loading, data, denied } = useSongwriting(slug, initial);
  if (denied) return <NoAccessNote />;
  const all = summariseNations(data.nations, data.trainings);
  const summaries = all.filter((s) => s.trainings > 0);
  const notYet = all.filter((s) => s.trainings === 0);
  const tentative = summaries.filter((s) => s.nation.status === "tentative").length;
  const reached = summaries.length;
  const editable = canEdit(data.viewer, { kind: "nation" });

  return (
    <div aria-busy={loading || undefined}>
      <section className={sw.hero} style={{ paddingBottom: 14 }} aria-label="Nations reached">
        <div className={sw.heroBig}>
          <span className={`${sw.heroNum} ${sw.heroNumSm}`}>{reached}</span>
          <span className={`${sw.heroOf} ${sw.heroOfSm}`}>/ {WORLD_NATIONS}</span>
        </div>
        <div className={sw.heroLabel}>
          Nations · {reached - tentative} confirmed, {tentative} tentative
        </div>
        <div className={`${pw.bar} ${sw.heroBar}`} aria-hidden="true">
          <span style={{ width: reachedPercent(reached) }} />
        </div>
      </section>
      <div className={`${pw.pad} ${pw.ruled} ${pw.btnrow}`}>
        <Link className={`${pw.btn} ${pw.grow}`} href={nationHref(slug, "new")}>
          + Add a nation
        </Link>
        <Link className={`${pw.btn} ${pw.grow}`} href={trainingHref(slug, "new")}>
          + Add a training
        </Link>
      </div>
      {summaries.length === 0 ? (
        <div className={pw.empty}>
          <div className={pw.emptyTitle}>{loading ? "Loading…" : "No nations reached yet"}</div>
          {loading ? null : <p className={pw.emptyText}>A nation counts as reached once it has a completed training.</p>}
        </div>
      ) : (
        summaries.map((s) => <NationCard key={s.nation.id} slug={slug} summary={s} editable={editable} />)
      )}
      {notYet.length > 0 ? (
        <>
          <div className={pw.sectionBar}>
            <h2 className={pw.sectionTitle}>Not reached yet</h2>
            <span className={pw.sectionMeta}>{notYet.length}</span>
          </div>
          {notYet.map(({ nation, languages }) => (
            <Link key={nation.id} className={pw.row} href={nationHref(slug, nation.id)}>
              <span className={sw.flag} aria-hidden="true">
                {nationCode(nation)}
              </span>
              <div className={pw.what}>
                <div className={pw.k}>{nation.name}</div>
                <div className={pw.s}>
                  {[nation.status === "tentative" ? "Tentative" : null, languages.length ? languages.join(", ") : "No trainings yet"]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <span className={pw.mono} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </>
      ) : null}
    </div>
  );
}

function NationCard({ slug, summary, editable }: { slug: string; summary: NationSummary; editable: boolean }) {
  const { nation, first, latest } = summary;
  const tentative = nation.status === "tentative";
  const same = first && latest && first.id === latest.id;
  return (
    <article className={`${sw.card} ${tentative ? sw.tent : ""}`}>
      <div className={`${sw.top} ${sw.topCenter}`}>
        <span className={sw.flag} aria-hidden="true">
          {nationCode(nation)}
        </span>
        <div className={pw.what}>
          <h2 className={sw.natTitle}>
            <Link href={nationHref(slug, nation.id)} style={{ color: "inherit", textDecoration: "none" }}>
              {nation.name} <span aria-hidden="true">→</span>
            </Link>
          </h2>
          <div className={sw.natSub}>
            {plural(summary.trainings, "training")} · {trainedText(summary)} trained · {plural(summary.songs, "song")}
          </div>
        </div>
        {tentative ? <span className={`${pw.pill} ${pw.pillDash}`}>Tentative</span> : null}
      </div>
      <div className={sw.grid}>
        {same && first ? (
          <div className={sw.full}>
            <div className={sw.gridLabel}>First and latest</div>
            <div className={sw.gridValue}>
              {monthLabel(first)} · {trainingTitle(first)}
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className={sw.gridLabel}>First</div>
              <div className={sw.gridValue}>{first ? `${monthLabel(first)} · ${trainingTitle(first)}` : "—"}</div>
            </div>
            <div>
              <div className={sw.gridLabel}>Latest</div>
              <div className={sw.gridValue}>{latest ? `${monthLabel(latest)} · ${trainingTitle(latest)}` : "—"}</div>
            </div>
          </>
        )}
      </div>
      {nation.notes ? <p className={sw.note}>{nation.notes}</p> : null}
      <div className={sw.tags}>
        <span className={`${pw.mono} ${sw.langsLabel}`}>Languages</span>
        {summary.languages.length ? (
          summary.languages.map((lang) => (
            <span key={lang} className={pw.chip}>
              {lang}
            </span>
          ))
        ) : (
          <span className={sw.none}>Not recorded</span>
        )}
        {editable ? (
          <Link className={sw.addline} href={nationHref(slug, nation.id, true)} aria-label={`Edit ${nation.name}'s languages`}>
            + Add
          </Link>
        ) : null}
      </div>
    </article>
  );
}
