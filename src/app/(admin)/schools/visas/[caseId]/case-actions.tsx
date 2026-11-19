"use client";

// The staff side of a case: Request approval (leader), Approve / Send back
// (legal), Ask legal, and recording what happened after approval. The
// buttons shown follow the case's status; the database checks every move.

import { useState } from "react";
import { SectionBar } from "@/components/ffsa";
import { ErrorLine, NoteBox, VisaButton, useVisaPost } from "@/components/visas/visa-ui";
import { formatDay } from "@/lib/visas/display";
import type { VisaStatus } from "@/lib/visas/status";

export interface RequestRow {
  id: string;
  requested_by: string | null;
  requested_at: string;
  leader_note: string | null;
  decision: "approved" | "sent_back" | null;
  decided_at: string | null;
  legal_note: string | null;
  requested_by_name: string;
  decided_by_name: string | null;
}

export interface QuestionRow {
  id: string;
  question: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  asked_by_name: string;
}

export function ApprovalPanel({
  caseId,
  status,
  missing,
  requests,
  isLegal,
  canFollow,
  currentUserId,
}: {
  caseId: string;
  status: VisaStatus;
  missing: string[];
  requests: RequestRow[];
  isLegal: boolean;
  canFollow: boolean;
  currentUserId: string;
}) {
  const { post, busy, error } = useVisaPost();
  const [note, setNote] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const open = requests.find((r) => r.decision === null);
  // Two people on every approval: the sender never sees Approve / Send back.
  const sentByMe = open?.requested_by === currentUserId;
  const collecting = status === "collecting_documents" || status === "sent_back";

  return (
    <div className="border border-ink">
      <SectionBar title="Approval" meta={open ? "Waiting for legal" : undefined} />
      <div className="px-5 py-4 md:px-6">
        {collecting && canFollow && (
          <div className="flex flex-col gap-2">
            {missing.length > 0 ? (
              <p className="text-[14px]">
                {missing.length === 1 ? "1 document still needs" : `${missing.length} documents still need`} to be approved
                or ticked before this can go to legal.
              </p>
            ) : (
              <>
                <p className="text-[14px]">Every document is in. Send the case to legal for approval.</p>
                <NoteBox value={note} onChange={setNote} placeholder="Anything legal should know (optional)" rows={2} />
                <div>
                  <VisaButton
                    disabled={busy}
                    onClick={() => post(`/api/visas/cases/${caseId}/request-approval`, { note }).then((ok) => ok && setNote(""))}
                  >
                    Request approval
                  </VisaButton>
                </div>
              </>
            )}
          </div>
        )}

        {open && isLegal && !sentByMe && (
          <div className="flex flex-col gap-2">
            <p className="text-[14px]">
              {open.requested_by_name} asked for approval on {formatDay(open.requested_at)}.
            </p>
            {open.leader_note && <p className="border-l-[3px] border-rule-strong pl-3 text-[14px]">{open.leader_note}</p>}
            {sendingBack && (
              <NoteBox value={note} onChange={setNote} placeholder="What needs fixing? The school leader sees this." rows={2} />
            )}
            <div className="flex flex-wrap gap-2">
              {!sendingBack && (
                <VisaButton disabled={busy} onClick={() => post(`/api/visas/requests/${open.id}/decide`, { approve: true })}>
                  Approve
                </VisaButton>
              )}
              <VisaButton
                tone="outline"
                disabled={busy || (sendingBack && !note.trim())}
                onClick={() => {
                  if (!sendingBack) return setSendingBack(true);
                  void post(`/api/visas/requests/${open.id}/decide`, { approve: false, note }).then((ok) => {
                    if (ok) {
                      setSendingBack(false);
                      setNote("");
                    }
                  });
                }}
              >
                Send back
              </VisaButton>
              {sendingBack && (
                <VisaButton tone="outline" onClick={() => setSendingBack(false)}>
                  Cancel
                </VisaButton>
              )}
            </div>
            <p className="mono-label">Signing FFSA&apos;s letters arrives with the letters themselves.</p>
          </div>
        )}
        {open && isLegal && sentByMe && (
          <p className="text-[14px]">You sent this request, so someone else with legal access has to decide it.</p>
        )}
        {open && !isLegal && <p className="text-[14px]">Waiting for legal to approve.</p>}

        {requests.filter((r) => r.decision).length > 0 && (
          <ul className="mt-4 border-t border-rule pt-3">
            {requests
              .filter((r) => r.decision)
              .map((r) => (
                <li key={r.id} className="py-2 text-[13px]">
                  <span className="mono-label mr-2">{formatDay(r.decided_at)}</span>
                  {r.decision === "approved" ? "Approved" : "Sent back"}
                  {r.decided_by_name ? ` by ${r.decided_by_name}` : ""}
                  {r.legal_note && <span className="text-[#55524A]"> — {r.legal_note}</span>}
                </li>
              ))}
          </ul>
        )}
        {!collecting && !open && requests.length === 0 && <p className="text-[14px] text-[#55524A]">No requests yet.</p>}
        <ErrorLine error={error} />
      </div>
    </div>
  );
}

export function QuestionsPanel({
  caseId,
  questions,
  isLegal,
  canFollow,
}: {
  caseId: string;
  questions: QuestionRow[];
  isLegal: boolean;
  canFollow: boolean;
}) {
  const { post, busy, error } = useVisaPost();
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="border border-ink">
      <SectionBar title="Ask legal" meta="Serious questions only" />
      <div className="px-5 py-4 md:px-6">
        {questions.length === 0 && <p className="text-[14px] text-[#55524A]">No questions on this case.</p>}
        <ul className="flex flex-col gap-4">
          {questions.map((q) => (
            <li key={q.id}>
              <div className="mono-label">
                {q.asked_by_name} · {formatDay(q.created_at)}
              </div>
              <p className="mt-1 text-[14px]">{q.question}</p>
              {q.answer ? (
                <p className="mt-2 border-l-[3px] border-ink pl-3 text-[14px]">
                  <span className="mono-label mr-2">Legal</span>
                  {q.answer}
                </p>
              ) : isLegal ? (
                <div className="mt-2 flex flex-col gap-2">
                  <NoteBox
                    value={answers[q.id] ?? ""}
                    onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                    placeholder="Your answer"
                    rows={2}
                  />
                  <div>
                    <VisaButton
                      disabled={busy || !(answers[q.id] ?? "").trim()}
                      onClick={() => post(`/api/visas/questions/${q.id}/answer`, { answer: answers[q.id] })}
                    >
                      Answer
                    </VisaButton>
                  </div>
                </div>
              ) : (
                <p className="mono-label mt-2">Waiting for legal</p>
              )}
            </li>
          ))}
        </ul>
        {canFollow && (
          <div className="mt-4 flex flex-col gap-2 border-t border-rule pt-4">
            <NoteBox value={question} onChange={setQuestion} placeholder="A question only legal can answer" rows={2} />
            <div>
              <VisaButton
                tone="outline"
                disabled={busy || !question.trim()}
                onClick={() => post(`/api/visas/cases/${caseId}/questions`, { question }).then((ok) => ok && setQuestion(""))}
              >
                Ask legal
              </VisaButton>
            </div>
          </div>
        )}
        <ErrorLine error={error} />
      </div>
    </div>
  );
}

type Field = { key: string; label: string; kind: "date" | "text" | "yesno"; required?: boolean };

const PROGRESS: Partial<Record<VisaStatus, { to: "lodged" | "granted" | "refused" | "arrived"; label: string; fields: Field[] }[]>> = {
  approved: [
    {
      to: "lodged",
      label: "Record lodged",
      fields: [
        { key: "lodged_on", label: "Lodged on", kind: "date", required: true },
        { key: "lodged_where", label: "Where", kind: "text" },
        { key: "embassy_reference", label: "Embassy reference", kind: "text" },
      ],
    },
  ],
  lodged: [
    {
      to: "granted",
      label: "Record granted",
      fields: [
        { key: "decided_on", label: "Decided on", kind: "date" },
        { key: "visa_valid_to", label: "Visa valid to", kind: "date", required: true },
      ],
    },
    {
      to: "refused",
      label: "Record refused",
      fields: [
        { key: "decided_on", label: "Decided on", kind: "date" },
        { key: "refusal_reason", label: "Reason given", kind: "text" },
      ],
    },
  ],
  granted: [
    {
      to: "arrived",
      label: "Record arrival",
      fields: [
        { key: "arrived_on", label: "Arrived on", kind: "date", required: true },
        { key: "entry_stamp_ok", label: "Entry stamp matches the visa", kind: "yesno", required: true },
      ],
    },
  ],
};
PROGRESS.exempt = PROGRESS.granted;

export function ProgressPanel({ caseId, status, isLegal }: { caseId: string; status: VisaStatus; isLegal: boolean }) {
  const { post, busy, error } = useVisaPost();
  const [active, setActive] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [closeNote, setCloseNote] = useState("");
  const steps = PROGRESS[status] ?? [];
  const closable = isLegal && status !== "closed" && status !== "withdrawn";
  if (steps.length === 0 && !closable) return null;
  const step = steps.find((s) => s.to === active);
  const ready = step?.fields.every((f) => !f.required || (values[f.key] ?? "") !== "") ?? false;

  function submit() {
    if (!step) return;
    const body: Record<string, string | boolean> = { status: step.to };
    for (const f of step.fields) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      body[f.key] = f.kind === "yesno" ? v === "yes" : v;
    }
    void post(`/api/visas/cases/${caseId}/progress`, body).then((ok) => {
      if (ok) {
        setActive(null);
        setValues({});
      }
    });
  }

  return (
    <div className="border border-ink">
      <SectionBar title="Progress" />
      <div className="flex flex-col gap-3 px-5 py-4 md:px-6">
        {steps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {steps.map((s) => (
              <VisaButton key={s.to} tone={active === s.to ? "solid" : "outline"} onClick={() => setActive(active === s.to ? null : s.to)}>
                {s.label}
              </VisaButton>
            ))}
          </div>
        )}
        {step && (
          <div className="flex flex-col gap-2">
            {step.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="mono-label">
                  {f.label}
                  {f.required ? "" : " (optional)"}
                </span>
                {f.kind === "yesno" ? (
                  <select
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="min-h-11 border border-rule-strong bg-white px-2 text-[14px]"
                  >
                    <option value="">Choose</option>
                    <option value="yes">Yes</option>
                    <option value="no">No, legal needs to look</option>
                  </select>
                ) : (
                  <input
                    type={f.kind === "date" ? "date" : "text"}
                    maxLength={200}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="min-h-11 border border-rule-strong bg-white px-2 text-[14px]"
                  />
                )}
              </label>
            ))}
            <div>
              <VisaButton disabled={busy || !ready} onClick={submit}>
                Save
              </VisaButton>
            </div>
          </div>
        )}
        {closable && (
          <div className="flex flex-col gap-2 border-t border-rule pt-3">
            <NoteBox value={closeNote} onChange={setCloseNote} placeholder="Why it's closing (optional)" rows={2} />
            <div className="flex flex-wrap gap-2">
              <VisaButton tone="outline" disabled={busy} onClick={() => {
                  if (window.confirm("Close this case? It can't be reopened.")) {
                    void post(`/api/visas/cases/${caseId}/close`, { withdrawn: false, note: closeNote });
                  }
                }}>
                Close case
              </VisaButton>
              <VisaButton tone="outline" disabled={busy} onClick={() => {
                  if (window.confirm("Mark this case withdrawn? It can't be reopened.")) {
                    void post(`/api/visas/cases/${caseId}/close`, { withdrawn: true, note: closeNote });
                  }
                }}>
                Mark withdrawn
              </VisaButton>
            </div>
          </div>
        )}
        <ErrorLine error={error} />
      </div>
    </div>
  );
}
