"use client";

import Link from "next/link";
import { useState } from "react";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy } from "@/components/song-library/client";
import sw from "./sw.module.css";
import { songwritingApi } from "./api";
import {
  initial,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_TONE,
  logSongHref,
  postSongRows,
  postSongSummary,
  sortLeads,
} from "./followup";
import { monthLabel } from "./overview";
import { trainingTitle } from "./trainings";
import type { SongwritingData, SongwritingLead } from "./types";
import { NoAccessNote } from "@/components/song-library/no-access";
import { useSongwriting } from "./use-songwriting";

const TONE_CLASS = { red: pw.pillRed, amber: pw.pillAmber, green: pw.pillGreen, plain: "" } as const;

export function FollowUpView({ slug, uploadHref, initial: seed }: { slug: string; uploadHref: string; initial?: SongwritingData }) {
  const { loading, data, denied } = useSongwriting(slug, seed);
  if (denied) return <NoAccessNote />;
  const nationById = new Map(data.nations.map((n) => [n.id, n]));
  const trainingById = new Map(data.trainings.map((t) => [t.id, t]));
  const rows = postSongRows(data.trainings, data.librarySongsByTraining);
  const summary = postSongSummary(rows);
  const leads = sortLeads(data.leads);
  const toContact = leads.filter((l) => l.status === "to_contact").length;

  return (
    <div aria-busy={loading || undefined}>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>Songs after workshops</h2>
        <span className={pw.sectionMeta}>
          {summary.known} known · {summary.logged} logged
        </span>
      </div>
      <p className={pw.hint}>Log each song so it reaches the library.</p>
      {rows.length === 0 ? (
        <p className={pw.hint}>{loading ? "Loading…" : "No trainings have songs written afterwards yet."}</p>
      ) : (
        rows.map(({ training, known, logged }) => {
          const nation = training.nation_id ? nationById.get(training.nation_id) : undefined;
          const title = [trainingTitle(training), training.location_text].filter(Boolean).join(" · ");
          return (
            <div key={training.id} className={sw.post}>
              <span className={`${sw.postN} ${known == null ? sw.postQ : ""}`} aria-label={known == null ? "Count not known" : `${known} songs`}>
                {known ?? "?"}
              </span>
              <div className={pw.what}>
                <div className={pw.k}>{title}</div>
                <div className={sw.postSub}>
                  {[nation?.name, monthLabel(training), known == null ? "count not known" : `${logged} in the library`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Link className={pw.btn} href={logSongHref(uploadHref, training.id)} aria-label={`Log a song from ${title}`}>
                Log song
              </Link>
            </div>
          );
        })
      )}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Leads to reconnect</h2>
        <span className={pw.sectionMeta}>
          {leads.length} · {toContact} to contact
        </span>
      </div>
      {leads.length === 0 ? (
        <p className={pw.hint}>{loading ? "Loading…" : "No leads yet. People and groups to follow up with will show here."}</p>
      ) : (
        leads.map((lead) => (
          <LeadCard
            key={lead.id}
            slug={slug}
            lead={lead}
            source={lead.source_training_id ? trainingById.get(lead.source_training_id) : undefined}
          />
        ))
      )}
    </div>
  );
}

function LeadCard({
  slug,
  lead,
  source,
}: {
  slug: string;
  lead: SongwritingLead;
  source: SongwritingData["trainings"][number] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const tone = LEAD_STATUS_TONE[lead.status];

  async function logContact() {
    if (busy || !note.trim()) return;
    setBusy(true);
    const result = await songwritingApi(slug).logContact(lead.id, note.trim());
    setBusy(false);
    if (!result.ok) {
      setMessage(errorCopy(result.code));
      return;
    }
    setMessage("Contact logged.");
    setNote("");
    setOpen(false);
  }

  return (
    <article className={pw.row} style={{ display: "block" }}>
      <div className={pw.btnrow} style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div className={pw.what}>
          <h3 className={pw.k} style={{ margin: 0 }}>
            {lead.label}
          </h3>
          {source ? (
            <div className={pw.s}>{[trainingTitle(source), source.location_text, monthLabel(source)].filter(Boolean).join(" · ")}</div>
          ) : null}
        </div>
        <span className={`${pw.pill} ${TONE_CLASS[tone]}`}>{LEAD_STATUS_LABEL[lead.status]}</span>
      </div>
      {lead.note ? <p className={sw.leadNote}>{lead.note}</p> : null}
      <div className={sw.meta}>
        <span className={pw.who}>
          <span className={pw.avatar} aria-hidden="true">
            {initial(lead.owner_name)}
          </span>
          {lead.owner_name ?? "Unassigned"}
        </span>
      </div>
      {open ? (
        <div className={pw.addRow}>
          <input
            className={pw.input}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened?"
            aria-label={`Contact note for ${lead.label}`}
          />
          <button type="button" className={`${pw.btn} ${pw.primary}`} onClick={logContact} disabled={busy || !note.trim()}>
            Save
          </button>
        </div>
      ) : (
        <div className={`${pw.btnrow} ${sw.leadActs}`}>
          <button type="button" className={`${pw.btn} ${pw.grow}`} onClick={() => setOpen(true)}>
            Log contact
          </button>
        </div>
      )}
      {message ? (
        <p className={pw.small} role="status" style={{ marginTop: 6 }}>
          {message}
        </p>
      ) : null}
    </article>
  );
}
