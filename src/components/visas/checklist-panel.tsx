"use client";

// The document checklist for one case. The student uploads and ticks here.
// School leaders check each upload against its objective points and mark it
// checked or flag a problem; they don't reject anything. Legal approves a
// document or asks for a redo. Police clearances and medical reports are
// legal-only. One row per document type, two lines on a phone, 44px+
// targets.

import { useRef, useState } from "react";
import { SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import { ITEM_LABEL, type ChecklistItem, type ItemState } from "@/lib/visas/checklist";
import { ErrorLine, NoteBox, VisaButton, openVisaDocument, useVisaPost } from "./visa-ui";

const TONE: Record<ItemState, Tone> = {
  missing: "quiet",
  uploaded: "warn",
  checked: "good",
  flagged: "bad",
  approved: "good",
  needs_redo: "bad",
  ticked: "good",
  with_legal: "quiet",
};

type ReviewAs = "leader" | "legal" | null;

export function ChecklistPanel({
  caseId,
  items,
  canChange,
  reviewAs = null,
  audience,
}: {
  caseId: string;
  items: ChecklistItem[];
  /** Documents can be added now (collecting or sent back) by this viewer. */
  canChange: boolean;
  /** How this viewer reviews right now: a leader checks, legal decides. */
  reviewAs?: ReviewAs;
  audience: "student" | "staff";
}) {
  const required = items.filter((i) => !i.type.is_conditional);
  const done = required.filter((i) => !i.blocking).length;
  return (
    <div className="border border-ink">
      <SectionBar title="Documents" meta={`${done} of ${required.length} done`} />
      <ul>
        {items.map((item) => (
          <ChecklistRow
            key={item.type.id}
            caseId={caseId}
            item={item}
            canChange={canChange}
            reviewAs={reviewAs}
            audience={audience}
          />
        ))}
      </ul>
    </div>
  );
}

function ChecklistRow({
  caseId,
  item,
  canChange,
  reviewAs,
  audience,
}: {
  caseId: string;
  item: ChecklistItem;
  canChange: boolean;
  reviewAs: ReviewAs;
  audience: "student" | "staff";
}) {
  const { post, busy, error, setError, refresh } = useVisaPost();
  const [redo, setRedo] = useState(false);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [issuedOn, setIssuedOn] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { type, latest, state } = item;

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("document_type_id", type.id);
    if (issuedOn) form.append("issued_on", issuedOn);
    try {
      const res = await fetch(`/api/visas/cases/${caseId}/documents`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.message ?? json.error ?? "Upload failed");
      else refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Restricted documents: the student uploads them; staff other than legal
  // never handle them (363 refuses it too).
  const mayUpload = audience === "student" || !type.is_restricted || reviewAs === "legal";
  const showUpload =
    canChange && mayUpload && !type.is_offline && (state === "missing" || state === "needs_redo" || state === "flagged" || state === "uploaded");
  const showTick = canChange && type.is_offline && (state === "missing" || state === "needs_redo");
  const showReview =
    !!latest &&
    ((reviewAs === "leader" && state === "uploaded" && !type.is_restricted) ||
      (reviewAs === "legal" && (state === "uploaded" || state === "checked" || state === "flagged")));
  const leaderReview = reviewAs === "leader";
  const noteFrom = state === "flagged" ? "From your school leader" : "From FFSA's legal officer";

  return (
    <li className="border-b border-rule px-5 py-4 last:border-b-0 md:px-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{type.label}</span>
            {type.is_conditional && <span className="mono-label">Only if it applies</span>}
            {type.is_offline && <span className="mono-label">Tick when done</span>}
            {type.is_restricted && <span className="mono-label">Legal only</span>}
          </div>
          {type.guidance && <p className="mt-1 text-[13px] text-[#55524A]">{type.guidance}</p>}
          {(state === "needs_redo" || state === "flagged") && latest?.review_note && (
            <p className="mt-2 border-l-[3px] border-yellow pl-3 text-[13px]">
              <span className="mono-label mr-2">
                {audience === "student" ? noteFrom : state === "flagged" ? "Flagged" : "Legal's redo note"}
              </span>
              {latest.review_note}
            </p>
          )}
          {showReview && leaderReview && type.leader_checks.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-[13px]">
              {type.leader_checks.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="mono-label shrink-0">Check</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusPill tone={TONE[state]}>{ITEM_LABEL[state]}</StatusPill>
          {latest?.storage_path && (
            <VisaButton tone="outline" onClick={() => openVisaDocument(latest.id)}>
              View
            </VisaButton>
          )}
        </div>
      </div>

      {(showUpload || showTick || showReview) && (
        <div className="mt-3 flex flex-col gap-2">
          {showUpload && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <label className="mono-label flex items-center gap-2">
                Issued on
                <input
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                  className="min-h-11 border border-rule-strong px-2 text-[14px]"
                />
              </label>
              <VisaButton disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : state === "missing" ? "Upload" : "Upload again"}
              </VisaButton>
            </div>
          )}
          {showTick && (
            <div>
              <VisaButton disabled={busy} onClick={() => post(`/api/visas/cases/${caseId}/documents/tick`, { document_type_id: type.id })}>
                Mark as done
              </VisaButton>
            </div>
          )}
          {showReview && latest && (
            <div className="flex flex-col gap-2">
              {redo && (
                <NoteBox
                  value={note}
                  onChange={setNote}
                  placeholder={leaderReview ? "What's wrong? The student sees this." : "What needs redoing? The student sees this."}
                  rows={2}
                />
              )}
              <div className="flex flex-wrap gap-2">
                {!redo && (
                  <VisaButton disabled={busy} onClick={() => post(`/api/visas/documents/${latest.id}/review`, { approve: true })}>
                    {leaderReview ? "Checked" : "Approve"}
                  </VisaButton>
                )}
                <VisaButton
                  tone="outline"
                  disabled={busy || (redo && !note.trim())}
                  onClick={() => {
                    if (!redo) return setRedo(true);
                    void post(`/api/visas/documents/${latest.id}/review`, { approve: false, note }).then((ok) => {
                      if (ok) {
                        setRedo(false);
                        setNote("");
                      }
                    });
                  }}
                >
                  {redo ? (leaderReview ? "Send the flag" : "Send for redo") : leaderReview ? "Flag a problem" : "Needs a redo"}
                </VisaButton>
                {redo && (
                  <VisaButton tone="outline" onClick={() => setRedo(false)}>
                    Cancel
                  </VisaButton>
                )}
              </div>
            </div>
          )}
          <ErrorLine error={error} />
        </div>
      )}
    </li>
  );
}
