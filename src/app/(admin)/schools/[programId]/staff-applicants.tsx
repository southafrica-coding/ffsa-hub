"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Masthead } from "@/components/ffsa";
import {
  INTERVIEW_OUTCOME_LABEL,
  INTERVIEW_OUTCOMES,
  type InterviewOutcome,
} from "@/lib/schools/interview-outcomes";
import {
  draftFromSaved,
  interviewClearFlags,
  interviewFormFromReview,
  reconcileInterviewDraft,
  type InterviewDraft,
} from "@/lib/schools/interview-review-form";

export type StaffApplicant = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  submittedAt: string | null;
  answers: Array<{ label: string; answer: string }>;
  notes: string;
  interviewOutcome: InterviewOutcome;
};

// The school a staff member actually sees: the applicants assigned to them,
// and a place to leave notes and an interview outcome. No fees, no form
// editor, no email editor.
function serverStamp(rows: StaffApplicant[]) {
  return JSON.stringify(rows.map((row) => [row.id, row.interviewOutcome, row.notes]));
}

export function StaffApplicants({
  programName,
  applicants: initialApplicants,
}: {
  programName: string;
  applicants: StaffApplicant[];
}) {
  const [applicants, setApplicants] = useState(initialApplicants);
  const stamp = serverStamp(initialApplicants);
  const [seenStamp, setSeenStamp] = useState(stamp);
  // Navigation and refresh pass a new server payload into the same client
  // instance. The first useState value would otherwise keep the empty form.
  if (stamp !== seenStamp) {
    setSeenStamp(stamp);
    setApplicants(initialApplicants);
  }

  return (
    <div className="ffsa-screen">
      <Masthead context="Training · Your applicants" title={programName} />
      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-6 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          These are the applicants assigned to you. Leave a note and an interview
          outcome. Accepting or declining the application stays with the school leaders.
        </p>
        {applicants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is assigned to you right now.</p>
        ) : (
          <ul className="space-y-6">
            {applicants.map((applicant) => (
              <li key={applicant.id} className="border border-ink bg-white">
                <ApplicantReview
                  applicant={applicant}
                  onSaved={(next) =>
                    setApplicants((rows) => rows.map((row) => (row.id === next.id ? next : row)))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ApplicantReview({
  applicant,
  onSaved,
}: {
  applicant: StaffApplicant;
  onSaved: (next: StaffApplicant) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedForm = interviewFormFromReview({
    notes: applicant.notes,
    interview_outcome: applicant.interviewOutcome,
  });
  const [draft, setDraft] = useState<InterviewDraft>(() => draftFromSaved(savedForm, applicant.id));
  const view = reconcileInterviewDraft(draft, savedForm, applicant.id);
  if (view !== draft) setDraft(view);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const stored = view.notes.trim();
    const flags = interviewClearFlags(view);
    const res = await fetch("/api/schools/applications/reviews", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_id: applicant.id,
        notes: stored,
        interview_outcome: view.outcome,
        clear_outcome: flags.clear_outcome,
        clear_notes: flags.clear_notes,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not save the review");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { review?: unknown };
    const storedForm = interviewFormFromReview(
      data.review ?? { notes: stored, interview_outcome: view.outcome }
    );
    setDraft(draftFromSaved(storedForm, applicant.id));
    onSaved({ ...applicant, notes: storedForm.notes, interviewOutcome: storedForm.outcome });
    setSaved(true);
  }

  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">{applicant.name}</h2>
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {applicant.status.replaceAll("_", " ")}
        </p>
      </div>
      {applicant.email && <p className="text-sm text-muted-foreground">{applicant.email}</p>}

      {applicant.answers.length > 0 && (
        <dl className="mt-4 space-y-3">
          {applicant.answers.map((answer, index) => (
            <div key={`${answer.label}-${index}`}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {answer.label}
              </dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm">{answer.answer || "—"}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Interview outcome
          </span>
          <select
            className="h-10 w-full border border-input bg-background px-3 text-sm"
            value={view.outcome}
            onChange={(event) =>
              setDraft({ ...view, outcome: event.target.value as InterviewOutcome })
            }
          >
            {INTERVIEW_OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {INTERVIEW_OUTCOME_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notes
          </span>
          <Textarea
            value={view.notes}
            onChange={(event) => setDraft({ ...view, notes: event.target.value })}
            rows={4}
            placeholder="What you want the leaders to know"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save review"}
        </Button>
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
