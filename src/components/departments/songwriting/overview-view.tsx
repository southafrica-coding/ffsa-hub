"use client";

import Link from "next/link";
import pw from "@/components/song-library/pw.module.css";
import sw from "./sw.module.css";
import { songwritingHref, trainingHref } from "./header";
import { computeOverview, heroBlurb, monthLabel, openLeadCount, reachedPercent, WORLD_NATIONS } from "./overview";
import { countText, trainingTitle } from "./trainings";
import type { SongwritingData } from "./types";
import { NoAccessNote } from "@/components/song-library/no-access";
import { useSongwriting } from "./use-songwriting";
import { canEdit } from "./permissions";

export function OverviewView({
  slug,
  uploadHref,
  initial,
}: {
  slug: string;
  uploadHref: string;
  initial?: SongwritingData;
}) {
  const { loading, data, denied } = useSongwriting(slug, initial);
  if (denied) return <NoAccessNote />;
  const totals = computeOverview({
    nations: data.nations,
    trainings: data.trainings,
    librarySongs: data.librarySongCount,
    openLeads: openLeadCount(data.leads),
  });
  const nationById = new Map(data.nations.map((n) => [n.id, n]));
  const latest = totals.latest;
  const latestNation = latest?.nation_id ? nationById.get(latest.nation_id) : undefined;
  const blurb = heroBlurb(totals);

  const rows: { label: string; key: "trainings" | "trained" | "songsWorkshop" | "songsAfter" | "newNations" | "continents" }[] = [
    { label: "Trainings", key: "trainings" },
    { label: "People trained", key: "trained" },
    { label: "Songs at workshops", key: "songsWorkshop" },
    { label: "Songs after", key: "songsAfter" },
    { label: "New nations", key: "newNations" },
    { label: "Continents", key: "continents" },
  ];

  return (
    <div aria-busy={loading || undefined}>
      <section className={sw.hero} aria-label="Nations reached">
        <div className={sw.heroBig}>
          <span className={sw.heroNum}>{totals.nationsReached}</span>
          <span className={sw.heroOf}>/ {WORLD_NATIONS}</span>
        </div>
        <div className={sw.heroLabel}>Nations reached</div>
        <div className={`${pw.bar} ${sw.heroBar}`} aria-hidden="true">
          <span style={{ width: reachedPercent(totals.nationsReached) }} />
        </div>
        {blurb ? <p className={sw.heroText}>{blurb}</p> : null}
      </section>

      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>By year</h2>
        {totals.span ? (
          <span className={pw.sectionMeta}>
            {monthLabel(totals.span.from)} – {monthLabel(totals.span.to)}
          </span>
        ) : null}
      </div>
      {totals.years.length === 0 ? (
        <p className={pw.hint}>{loading ? "Loading trainings…" : "No completed trainings yet. Add the first one below."}</p>
      ) : (
        <table className={sw.ytable}>
          <thead>
            <tr>
              <th scope="col">
                <span className={pw.srOnly}>Measure</span>
              </th>
              {totals.years.map((y) => (
                <th key={y.year} scope="col">
                  {y.year}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={sw.rowHead}>
                  {row.label}
                </th>
                {totals.years.map((y) => (
                  <td key={y.year}>{y[row.key]}</td>
                ))}
                <td className={sw.tot}>
                  {row.key === "continents" ? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className={pw.srOnly}>not totalled</span>
                    </>
                  ) : (
                    totals.total[row.key]
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={pw.kpis}>
        <div className={pw.kpi}>
          <div className={pw.numeral}>{totals.songsApprox}</div>
          <div className={pw.kpiLabel}>Songs total (approx.)</div>
        </div>
        <div className={pw.kpi}>
          <div className={pw.numeral}>{totals.librarySongs}</div>
          <div className={pw.kpiLabel}>In the song library</div>
        </div>
        <div className={pw.kpi}>
          <div className={pw.numeral}>{totals.openLeads}</div>
          <div className={pw.kpiLabel}>Leads to reconnect</div>
        </div>
      </div>

      {latest ? (
        <>
          <div className={pw.sectionBar}>
            <h2 className={pw.sectionTitle}>Latest training</h2>
            <span className={pw.sectionMeta}>{monthLabel(latest)}</span>
          </div>
          <Link
            className={pw.row}
            href={
              canEdit(data.viewer, { kind: "training", created_by: latest.created_by })
                ? trainingHref(slug, latest.id)
                : songwritingHref(slug, "trainings")
            }
          >
            <div className={pw.what}>
              <div className={pw.k}>{[trainingTitle(latest), latest.location_text].filter(Boolean).join(" · ")}</div>
              <div className={pw.s}>
                {[
                  latestNation?.name,
                  `${countText(latest.people_trained)} trained`,
                  `${countText(latest.songs_workshop)} ${latest.songs_workshop === 1 ? "song" : "songs"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <span className={pw.mono} aria-hidden="true">
              →
            </span>
          </Link>
        </>
      ) : null}

      <div className={`${pw.pad} ${pw.btnrow}`}>
        <Link className={`${pw.btn} ${pw.primary} ${pw.grow}`} href={trainingHref(slug, "new")}>
          + Add training
        </Link>
        <Link className={`${pw.btn} ${pw.grow}`} href={uploadHref}>
          + Add song
        </Link>
      </div>
      <p className={pw.hint}>
        Songs go into the Song Library. <Link href={songwritingHref(slug, "library")}>Open the library</Link>.
      </p>
    </div>
  );
}
