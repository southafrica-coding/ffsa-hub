"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy, fieldCopy } from "@/components/song-library/client";
import { NoAccessNote } from "@/components/song-library/no-access";
import { formatSaDate } from "@/lib/format/sa-time";
import { songwritingApi } from "./api";
import { CannotEditNote, NotFoundNote } from "./fields";
import { LEAD_STATUS_LABEL } from "./followup";
import { leadHref, songwritingHref } from "./header";
import { LEAD_KIND_LABEL, LEAD_KINDS, LEAD_STATUSES, leadToDraft, leadToInput, type LeadDraft } from "./lead-draft";
import { monthLabel, newestFirst } from "./overview";
import { canEdit, cannotEditCopy } from "./permissions";
import { trainingTitle } from "./trainings";
import type { SongwritingData, SongwritingLead } from "./types";
import { useSongwriting } from "./use-songwriting";

export function LeadForm({ slug, leadId, initial }: { slug: string; leadId: string | null; initial?: SongwritingData }) {
  const { loading, data, denied } = useSongwriting(slug, initial);
  const params = useSearchParams();
  if (denied) return <NoAccessNote />;
  if (loading) return <p className={pw.hint}>Loading…</p>;
  const list = songwritingHref(slug, "follow-up");
  const lead = leadId ? (data.leads.find((l) => l.id === leadId) ?? null) : null;
  if (leadId && !lead) return <NotFoundNote title="Lead not found" backHref={list} backLabel="Back to follow-up" />;
  if (lead && !canEdit(data.viewer, { kind: "lead", created_by: lead.created_by })) {
    return <CannotEditNote text={cannotEditCopy("lead")} backHref={leadHref(slug, lead.id)} backLabel="Back to the lead" />;
  }
  // /follow-up/new?nation_id=…&source_training_id=… prefill from the nation page or a training.
  const defaults: Partial<LeadDraft> = {};
  const nationId = params?.get("nation_id");
  const trainingId = params?.get("source_training_id");
  if (nationId && data.nations.some((n) => n.id === nationId)) defaults.nation_id = nationId;
  if (trainingId && data.trainings.some((t) => t.id === trainingId)) defaults.source_training_id = trainingId;
  return <LeadFormBody key={lead?.id ?? "new"} slug={slug} lead={lead} data={data} defaults={defaults} />;
}

function LeadFormBody({
  slug,
  lead,
  data,
  defaults,
}: {
  slug: string;
  lead: SongwritingLead | null;
  data: SongwritingData;
  defaults: Partial<LeadDraft>;
}) {
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<LeadDraft>(() => leadToDraft(lead, defaults));
  const [fields, setFields] = useState<string[]>([]);
  const [fieldCode, setFieldCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const back = lead ? leadHref(slug, lead.id) : songwritingHref(slug, "follow-up");
  const me = data.viewer?.user_id ?? null;
  const trainings = [...data.trainings].sort(newestFirst);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = leadToInput(draft);
    if ("fields" in parsed) {
      setFields(parsed.fields);
      setFieldCode(null);
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    setError(null);
    setFields([]);
    const api = songwritingApi(slug);
    const result = lead ? await api.updateLead(lead.id, parsed.input) : await api.createLead(parsed.input);
    setBusy(false);
    if (!result.ok) {
      setFields(result.fields);
      setFieldCode(result.code);
      setError(errorCopy(result.code));
      return;
    }
    router.push(leadHref(slug, result.data.lead.id));
    router.refresh();
  }

  async function onDelete() {
    if (!lead || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const result = await songwritingApi(slug).deleteLead(lead.id);
    setBusy(false);
    if (!result.ok) {
      setConfirmDelete(false);
      setError(errorCopy(result.code));
      return;
    }
    router.push(songwritingHref(slug, "follow-up"));
    router.refresh();
  }

  const fieldError = (name: string) =>
    fields.includes(name) ? (
      <p className={pw.error} id={`${id}-${name}-err`}>
        {fieldCopy(name, fieldCode)}
      </p>
    ) : null;
  const describedBy = (name: string, hint?: string) =>
    [fields.includes(name) ? `${id}-${name}-err` : null, hint].filter(Boolean).join(" ") || undefined;
  const invalid = (name: string) => fields.includes(name) || undefined;

  // Owner: unassigned, me, or whoever it is now (we have their name, not a list of people).
  const ownerOptions: { value: string; label: string }[] = [{ value: "", label: "Unassigned" }];
  if (me) ownerOptions.push({ value: me, label: "Me" });
  if (lead?.owner_user_id && lead.owner_user_id !== me) ownerOptions.push({ value: lead.owner_user_id, label: lead.owner_name ?? "Current owner" });

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>{lead ? "Edit lead" : "Add lead"}</h2>
        {lead ? <span className={pw.sectionMeta}>last edited {formatSaDate(lead.updated_at)}</span> : null}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-label`}>
          Who
        </label>
        <input
          id={`${id}-label`}
          className={pw.input}
          value={draft.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder="e.g. Worship team, Antsirabe church"
          aria-invalid={invalid("label")}
          aria-describedby={describedBy("label", `${id}-label-hint`)}
        />
        <p className={`${pw.small} ${pw.muted}`} id={`${id}-label-hint`} style={{ marginTop: 6 }}>
          A name or short label. Phone numbers and emails stay in the CRM, not here.
        </p>
        {fieldError("label")}
      </div>

      <div className={`${pw.field} ${pw.two}`}>
        <div>
          <label className={pw.label} htmlFor={`${id}-kind`}>
            Kind
          </label>
          <select
            id={`${id}-kind`}
            className={pw.input}
            value={draft.kind}
            onChange={(e) => set("kind", e.target.value as LeadDraft["kind"])}
            aria-invalid={invalid("kind")}
            aria-describedby={describedBy("kind")}
          >
            {LEAD_KINDS.map((k) => (
              <option key={k} value={k}>
                {LEAD_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {fieldError("kind")}
        </div>
        <div>
          <label className={pw.label} htmlFor={`${id}-status`}>
            Status
          </label>
          <select
            id={`${id}-status`}
            className={pw.input}
            value={draft.status}
            onChange={(e) => set("status", e.target.value as LeadDraft["status"])}
            aria-invalid={invalid("status")}
            aria-describedby={describedBy("status")}
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {fieldError("status")}
        </div>
      </div>

      <div className={`${pw.field} ${pw.two}`}>
        <div>
          <label className={pw.label} htmlFor={`${id}-nation`}>
            Nation
          </label>
          <select
            id={`${id}-nation`}
            className={pw.input}
            value={draft.nation_id}
            onChange={(e) => set("nation_id", e.target.value)}
            aria-invalid={invalid("nation_id")}
            aria-describedby={describedBy("nation_id")}
          >
            <option value="">Not set</option>
            {data.nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          {fieldError("nation_id")}
        </div>
        <div>
          <label className={pw.label} htmlFor={`${id}-owner`}>
            Who follows up
          </label>
          <select
            id={`${id}-owner`}
            className={pw.input}
            value={draft.owner_user_id}
            onChange={(e) => set("owner_user_id", e.target.value)}
            aria-invalid={invalid("owner_user_id")}
            aria-describedby={describedBy("owner_user_id")}
          >
            {ownerOptions.map((o) => (
              <option key={o.value || "none"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldError("owner_user_id")}
        </div>
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-training`}>
          From training
        </label>
        <select
          id={`${id}-training`}
          className={pw.input}
          value={draft.source_training_id}
          onChange={(e) => set("source_training_id", e.target.value)}
          aria-invalid={invalid("source_training_id")}
          aria-describedby={describedBy("source_training_id")}
        >
          <option value="">None</option>
          {trainings.map((t) => (
            <option key={t.id} value={t.id}>
              {[trainingTitle(t), monthLabel(t)].join(" · ")}
            </option>
          ))}
        </select>
        {fieldError("source_training_id")}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-note`}>
          Note
        </label>
        <textarea
          id={`${id}-note`}
          className={pw.input}
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="Why follow up, and what's next"
          aria-invalid={invalid("note")}
          aria-describedby={describedBy("note")}
        />
        {fieldError("note")}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-contact`}>
          Hub account (optional)
        </label>
        <input
          id={`${id}-contact`}
          className={pw.input}
          value={draft.contact_user_id}
          onChange={(e) => set("contact_user_id", e.target.value)}
          placeholder="Account id"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid("contact_user_id")}
          aria-describedby={describedBy("contact_user_id", `${id}-contact-hint`)}
        />
        <p className={`${pw.small} ${pw.quiet}`} id={`${id}-contact-hint`} style={{ marginTop: 6 }}>
          Only if this person has a Hub login. Leave it blank otherwise.
        </p>
        {fieldError("contact_user_id")}
      </div>

      {lead && canEdit(data.viewer, { kind: "lead", created_by: lead.created_by }) ? (
        <div className={pw.field}>
          <button type="button" className={`${pw.btn} ${pw.ghost} ${pw.danger} ${pw.block}`} onClick={onDelete} disabled={busy}>
            {confirmDelete ? "Tap again to delete" : "Delete lead"}
          </button>
          <p className={`${pw.small} ${pw.quiet}`} style={{ marginTop: 6 }}>
            Its logged contacts are deleted with it.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className={pw.status} role="alert">
          {error}
        </p>
      ) : null}

      <div className={pw.savebar}>
        <Link className={pw.btn} href={back}>
          Cancel
        </Link>
        <button type="submit" className={`${pw.btn} ${pw.primary}`} disabled={busy}>
          {busy ? "Saving…" : lead ? "Save changes" : "Add lead"}
        </button>
      </div>
    </form>
  );
}
