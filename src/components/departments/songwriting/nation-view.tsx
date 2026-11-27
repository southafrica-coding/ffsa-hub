"use client";

import Link from "next/link";
import pw from "@/components/song-library/pw.module.css";
import { NoAccessNote } from "@/components/song-library/no-access";
import sw from "./sw.module.css";
import { NotFoundNote } from "./fields";
import { leadHref, nationHref, songwritingHref, trainingHref } from "./header";
import { LEAD_STATUS_LABEL, sortLeads } from "./followup";
import { CONTINENT_LABEL } from "./nation-draft";
import { nationCode, plural, summariseNations, trainedText } from "./nations";
import { newestFirst } from "./overview";
import { canEdit } from "./permissions";
import { TrainingCard } from "./trainings-view";
import type { SongwritingData } from "./types";
import { useSongwriting } from "./use-songwriting";

/** One nation: its code, languages, notes, trainings and leads. */
export function NationView({ slug, nationId, initial }: { slug: string; nationId: string; initial?: SongwritingData }) {
  const { loading, data, denied } = useSongwriting(slug, initial);
  if (denied) return <NoAccessNote />;
  if (loading) return <p className={pw.hint}>Loading the nation…</p>;
  const nation = data.nations.find((n) => n.id === nationId);
  if (!nation) return <NotFoundNote title="Nation not found" backHref={songwritingHref(slug, "nations")} backLabel="Back to nations" />;

  const summary = summariseNations([nation], data.trainings)[0];
  const trainings = data.trainings.filter((t) => t.nation_id === nation.id).sort(newestFirst);
  const leads = sortLeads(data.leads.filter((l) => l.nation_id === nation.id));
  const tentative = nation.status === "tentative";
  const editable = canEdit(data.viewer, { kind: "nation" });
  const storedLanguages = nation.languages.length > 0;

  return (
    <div>
      <article className={`${sw.card} ${tentative ? sw.tent : ""}`}>
        <div className={`${sw.top} ${sw.topCenter}`}>
          <span className={sw.flag} aria-hidden="true">
            {nationCode(nation)}
          </span>
          <div className={pw.what}>
            <h2 className={sw.natTitle}>{nation.name}</h2>
            <div className={sw.natSub}>
              {[nation.continent ? CONTINENT_LABEL[nation.continent] : null, nation.iso_code].filter(Boolean).join(" · ") || "Continent not set"}
            </div>
          </div>
          {tentative ? <span className={`${pw.pill} ${pw.pillDash}`}>Tentative</span> : null}
        </div>
        <div className={sw.natSub} style={{ marginTop: 8 }}>
          {plural(summary.trainings, "training")} · {trainedText(summary)} trained · {plural(summary.songs, "song")}
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
        </div>
        {!storedLanguages && summary.languages.length ? (
          <p className={`${pw.small} ${pw.quiet}`} style={{ marginTop: 6 }}>
            From this nation&apos;s trainings. Add them to the nation to keep them here.
          </p>
        ) : null}
      </article>

      <div className={`${pw.pad} ${pw.btnrow}`}>
        {editable ? (
          <Link className={`${pw.btn} ${pw.grow}`} href={nationHref(slug, nation.id, true)}>
            Edit nation
          </Link>
        ) : null}
        <Link className={`${pw.btn} ${pw.grow}`} href={trainingHref(slug, "new")}>
          + Add a training
        </Link>
      </div>

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Trainings</h2>
        <span className={pw.sectionMeta}>{trainings.length}</span>
      </div>
      {trainings.length === 0 ? (
        <p className={pw.hint}>No trainings in {nation.name} yet.</p>
      ) : (
        trainings.map((t) => (
          <TrainingCard
            key={t.id}
            slug={slug}
            training={t}
            nation={nation}
            editable={canEdit(data.viewer, { kind: "training", created_by: t.created_by })}
          />
        ))
      )}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Leads</h2>
        <span className={pw.sectionMeta}>{leads.length}</span>
      </div>
      <div className={pw.pad}>
        <Link className={`${pw.btn} ${pw.block}`} href={`${leadHref(slug, "new")}?nation_id=${encodeURIComponent(nation.id)}`}>
          + Add a lead in {nation.name}
        </Link>
      </div>
      {leads.length === 0 ? (
        <p className={pw.hint}>No leads in {nation.name}.</p>
      ) : (
        leads.map((lead) => (
          <Link key={lead.id} className={pw.row} href={leadHref(slug, lead.id)}>
            <div className={pw.what}>
              <div className={pw.k}>{lead.label}</div>
              <div className={pw.s}>
                {LEAD_STATUS_LABEL[lead.status]} · {lead.owner_name ?? "Unassigned"}
              </div>
            </div>
            <span className={pw.mono} aria-hidden="true">
              →
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
