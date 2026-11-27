"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy } from "@/components/song-library/client";
import { NoAccessNote } from "@/components/song-library/no-access";
import { formatSaDate } from "@/lib/format/sa-time";
import sw from "./sw.module.css";
import { songwritingApi } from "./api";
import { NotFoundNote } from "./fields";
import { applyDeletedContact, applyLoggedContact, initial, LEAD_STATUS_LABEL, LEAD_STATUS_TONE } from "./followup";
import { leadHref, nationHref, songwritingHref } from "./header";
import { LEAD_KIND_LABEL } from "./lead-draft";
import { monthLabel } from "./overview";
import { canEdit } from "./permissions";
import { trainingTitle } from "./trainings";
import type { SongwritingData, SongwritingLead, SongwritingLeadEvent } from "./types";
import { useSongwriting } from "./use-songwriting";

const TONE_CLASS = { red: pw.pillRed, amber: pw.pillAmber, green: pw.pillGreen, plain: "" } as const;

type LeadLoad = { state: "loading" } | { state: "ok"; lead: SongwritingLead; events: SongwritingLeadEvent[] } | { state: "missing" } | { state: "denied" } | { state: "error"; code: string | null };

/** One lead: what it is, who follows up, and its logged contacts (append-only). */
export function LeadView({ slug, leadId, initial: seed }: { slug: string; leadId: string; initial?: SongwritingData }) {
  const { data, denied, patchLead } = useSongwriting(slug, seed);
  const [load, setLoad] = useState<LeadLoad>({ state: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    songwritingApi(slug)
      .loadLead(leadId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setLoad({ state: "ok", lead: result.data.lead, events: result.data.events ?? [] });
        else if (result.status === 403 || result.code === "forbidden") setLoad({ state: "denied" });
        else if (result.status === 404 || result.code === "not_found") setLoad({ state: "missing" });
        else setLoad({ state: "error", code: result.code });
      });
    return () => controller.abort();
  }, [slug, leadId, tick]);

  if (denied || load.state === "denied") return <NoAccessNote />;
  if (load.state === "loading") return <p className={pw.hint}>Loading the lead…</p>;
  if (load.state === "missing") return <NotFoundNote title="Lead not found" backHref={songwritingHref(slug, "follow-up")} backLabel="Back to follow-up" />;
  if (load.state === "error") {
    return (
      <p className={pw.status} role="alert">
        {errorCopy(load.code)}
      </p>
    );
  }

  const { lead, events } = load;
  const nation = lead.nation_id ? data.nations.find((n) => n.id === lead.nation_id) : undefined;
  const source = lead.source_training_id ? data.trainings.find((t) => t.id === lead.source_training_id) : undefined;
  const editable = canEdit(data.viewer, { kind: "lead", created_by: lead.created_by });

  return (
    <div>
      <article className={sw.card}>
        <div className={sw.top}>
          <div className={pw.what}>
            <h2 className={sw.cardTitle}>{lead.label}</h2>
            <div className={sw.cardSub}>
              {[LEAD_KIND_LABEL[lead.kind], nation?.name, source ? `${trainingTitle(source)} · ${monthLabel(source)}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <span className={`${pw.pill} ${TONE_CLASS[LEAD_STATUS_TONE[lead.status]]}`}>{LEAD_STATUS_LABEL[lead.status]}</span>
        </div>
        {lead.note ? <p className={sw.leadNote}>{lead.note}</p> : null}
        <div className={sw.meta}>
          <span className={pw.who}>
            <span className={pw.avatar} aria-hidden="true">
              {initial(lead.owner_name)}
            </span>
            {lead.owner_name ?? "Unassigned"}
          </span>
          <span className={pw.small}>{lead.last_contact_at ? `Last contact ${formatSaDate(lead.last_contact_at)}` : "Not contacted yet"}</span>
        </div>
        {lead.contact_user_id ? (
          <p className={`${pw.small} ${pw.quiet}`} style={{ marginTop: 6 }}>
            Has a Hub account.
          </p>
        ) : null}
      </article>

      <div className={`${pw.pad} ${pw.btnrow}`}>
        {editable ? (
          <Link className={`${pw.btn} ${pw.grow}`} href={leadHref(slug, lead.id, true)}>
            Edit lead
          </Link>
        ) : null}
        {nation ? (
          <Link className={`${pw.btn} ${pw.grow}`} href={nationHref(slug, nation.id)}>
            {nation.name}
          </Link>
        ) : null}
      </div>

      <LogContact
        slug={slug}
        lead={lead}
        onLogged={(reply) => {
          setLoad((prev) => {
            if (prev.state !== "ok") return prev;
            const next = applyLoggedContact(prev.events, reply);
            return { state: "ok", lead: next.lead, events: next.events };
          });
          patchLead(reply.lead);
        }}
      />

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Logged contacts</h2>
        <span className={pw.sectionMeta}>{events.length}</span>
      </div>
      {events.length === 0 ? (
        <p className={pw.hint}>Nothing logged yet.</p>
      ) : (
        events.map((event) => (
          <ContactRow
            key={event.id}
            slug={slug}
            leadId={lead.id}
            event={event}
            deletable={canEdit(data.viewer, { kind: "lead_event", by: event.by })}
            onDeleted={(reply) => {
              setLoad((prev) => {
                if (prev.state !== "ok") return prev;
                const next = applyDeletedContact(prev.events, reply);
                return { state: "ok", lead: next.lead, events: next.events };
              });
              patchLead(reply.lead);
            }}
          />
        ))
      )}
    </div>
  );
}

function LogContact({
  slug,
  lead,
  onLogged,
}: {
  slug: string;
  lead: SongwritingLead;
  onLogged: (reply: { lead: SongwritingLead; event: SongwritingLeadEvent }) => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (busy || !note.trim()) return;
    setBusy(true);
    // { note } only: by and last_contact_at are the database's.
    const result = await songwritingApi(slug).logContact(lead.id, { note: note.trim() });
    setBusy(false);
    if (!result.ok) {
      setMessage(errorCopy(result.code));
      return;
    }
    setNote("");
    setMessage("Contact logged.");
    onLogged(result.data);
  }

  return (
    <div className={pw.field} style={{ paddingInline: 0 }}>
      <label className={pw.label} htmlFor={`${id}-note`}>
        Log contact
      </label>
      <div className={pw.addRow}>
        <input
          id={`${id}-note`}
          className={pw.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened?"
        />
        <button type="button" className={`${pw.btn} ${pw.primary}`} onClick={save} disabled={busy || !note.trim()}>
          Save
        </button>
      </div>
      {message ? (
        <p className={pw.small} role="status" style={{ marginTop: 6 }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ContactRow({
  slug,
  leadId,
  event,
  deletable,
  onDeleted,
}: {
  slug: string;
  leadId: string;
  event: SongwritingLeadEvent;
  deletable: boolean;
  onDeleted: (reply: { lead: SongwritingLead; deleted: string }) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    const result = await songwritingApi(slug).deleteContact(leadId, event.id);
    setBusy(false);
    if (!result.ok) {
      setConfirm(false);
      setMessage(errorCopy(result.code));
      return;
    }
    onDeleted(result.data);
  }

  return (
    <div className={pw.row} style={{ display: "block" }}>
      <div className={pw.btnrow} style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div className={pw.what}>
          <div className={pw.k}>{event.note ?? "Contact"}</div>
          <div className={pw.s}>
            {formatSaDate(event.at)} · {event.by_name ?? "Someone"}
          </div>
        </div>
        {deletable ? (
          <button type="button" className={`${pw.btn} ${pw.ghost} ${pw.danger}`} onClick={remove} disabled={busy}>
            {confirm ? "Tap again" : "Delete"}
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={pw.small} role="alert" style={{ marginTop: 6 }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
