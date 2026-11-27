"use client";

// FFSA's letters on a case.
//   Legal: issue a letter from the current template (preview first),
//          print the PDF to sign and stamp, upload the scan, re-issue or
//          withdraw.
//   School leaders: see where each letter is, nothing more (the letter
//          shows the passport number).
//   Student: open each letter to check the details, confirm or say what's
//          wrong, then download the signed scan.
// The database (366) checks every move again.

import { useRef, useState } from "react";
import { SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import { ErrorLine, NoteBox, VisaButton, openVisaLetterScan, useVisaPost } from "@/components/visas/visa-ui";
import { formatDay } from "@/lib/visas/display";
import { LETTER_KIND_LABEL, type LetterKind } from "@/lib/visas/letters";

export type LetterStatus = "with_student" | "needs_fix" | "confirmed" | "signed" | "replaced" | "withdrawn";

export interface LetterRow {
  id: string;
  kind: LetterKind;
  title: string;
  status: LetterStatus;
  letter_date: string;
  school: string | null;
  student_note: string | null;
  status_note: string | null;
  created_at: string;
}

export interface IssuableTemplate {
  id: string;
  kind: LetterKind;
  title: string;
  version: number;
  school: string | null;
  fields: Array<{ key: string; label: string; date?: boolean }>;
  sections: Array<{ key: string; label: string }>;
}

const STAFF_LABEL: Record<LetterStatus, string> = {
  with_student: "With the student to check",
  needs_fix: "Student found a problem",
  confirmed: "Ready to sign",
  signed: "Signed",
  replaced: "Replaced",
  withdrawn: "Withdrawn",
};
const STAFF_TONE: Record<LetterStatus, Tone> = {
  with_student: "quiet",
  needs_fix: "warn",
  confirmed: "warn",
  signed: "good",
  replaced: "quiet",
  withdrawn: "quiet",
};
const STUDENT_LABEL: Record<LetterStatus, string> = {
  with_student: "Check the details",
  needs_fix: "Being corrected",
  confirmed: "Waiting for FFSA to sign",
  signed: "Signed",
  replaced: "Replaced",
  withdrawn: "Withdrawn",
};

const live = (l: LetterRow) => l.status !== "replaced" && l.status !== "withdrawn";

function letterName(l: { kind: LetterKind; school: string | null }) {
  return `${LETTER_KIND_LABEL[l.kind]}${l.school ? ` · ${l.school}` : ""}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ────────────────────────────────────────────────────────────
// STAFF
// ────────────────────────────────────────────────────────────

export function StaffLettersPanel({
  caseId,
  letters,
  templates,
  isLegal,
  canIssue,
  stayFrom,
  stayTo,
  defaults = {},
}: {
  caseId: string;
  letters: LetterRow[];
  /** Current templates that fit this case (legal only). */
  templates: IssuableTemplate[];
  isLegal: boolean;
  /** The case is approved (or exempt / further on): letters can be issued. */
  canIssue: boolean;
  stayFrom: string | null;
  stayTo: string | null;
  /** Fields filled in for legal from the case's embassy (addressee, city); legal can change them. */
  defaults?: Record<string, string>;
}) {
  const [issuing, setIssuing] = useState<string | null>(null);
  const current = letters.filter(live);
  const earlier = letters.filter((l) => !live(l));

  return (
    <div className="border border-ink">
      <SectionBar title="Letters" meta={current.length > 0 ? `${current.length} live` : undefined} />
      <div className="px-5 py-4 md:px-6">
        {current.length === 0 && (
          <p className="text-[14px] text-[#55524A]">
            {canIssue ? "No letters yet." : "Letters are issued once legal has approved the case."}
          </p>
        )}
        <ul>
          {current.map((l) => (
            <StaffLetter key={l.id} letter={l} isLegal={isLegal} onReissue={() => setIssuing(templates.find((t) => t.kind === l.kind && t.school === l.school)?.id ?? "")} />
          ))}
        </ul>

        {isLegal && canIssue && (
          <div className="mt-4 border-t border-rule pt-4">
            {issuing === null ? (
              templates.length > 0 ? (
                <VisaButton onClick={() => setIssuing(templates[0].id)}>Issue a letter</VisaButton>
              ) : (
                <p className="text-[14px] text-[#55524A]">
                  No published letter fits this case yet. Letters are set up under Visas → Letter templates.
                </p>
              )
            ) : (
              <IssueForm
                caseId={caseId}
                templates={templates}
                initial={issuing}
                stayFrom={stayFrom}
                defaults={defaults}
                stayTo={stayTo}
                onDone={() => setIssuing(null)}
              />
            )}
          </div>
        )}

        {earlier.length > 0 && (
          <details className="mt-4 border-t border-rule pt-3">
            <summary className="mono-label cursor-pointer">Earlier letters ({earlier.length})</summary>
            <ul className="mt-2">
              {earlier.map((l) => (
                <li key={l.id} className="py-1.5 text-[13px]">
                  <span className="mono-label mr-2">{formatDay(l.letter_date)}</span>
                  {letterName(l)} · {STAFF_LABEL[l.status]}
                  {l.status_note && <span className="text-[#55524A]"> — {l.status_note}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function StaffLetter({ letter: l, isLegal, onReissue }: { letter: LetterRow; isLegal: boolean; onReissue: () => void }) {
  const { post, busy, error, setError, refresh } = useVisaPost();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState("");

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/visas/letters/${l.id}/scan`, { method: "POST", body: form }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res || !res.ok) return setError(json.error ?? "Upload failed");
    refresh();
  }

  return (
    <li className="border-b border-rule py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{letterName(l)}</div>
          <div className="mono-label mt-1">Dated {formatDay(l.letter_date)}</div>
        </div>
        <StatusPill tone={STAFF_TONE[l.status]}>{STAFF_LABEL[l.status]}</StatusPill>
      </div>

      {l.status === "needs_fix" && l.student_note && (
        <p className="mt-2 border-l-[3px] border-rule-strong pl-3 text-[14px]">The student says: {l.student_note}</p>
      )}

      {isLegal && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/visas/letters/${l.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center border border-ink bg-white px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
            >
              {l.status === "confirmed" ? "Print to sign" : "Open PDF"}
            </a>
            {l.status === "confirmed" && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <VisaButton disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? "Uploading…" : "Upload signed scan"}
                </VisaButton>
              </>
            )}
            {l.status === "signed" && (
              <VisaButton tone="outline" onClick={() => openVisaLetterScan(l.id)}>
                Open signed scan
              </VisaButton>
            )}
            {(l.status === "needs_fix" || l.status === "with_student") && (
              <VisaButton tone="outline" onClick={onReissue}>
                Re-issue
              </VisaButton>
            )}
            {!withdrawing && (
              <VisaButton tone="outline" onClick={() => setWithdrawing(true)}>
                Withdraw
              </VisaButton>
            )}
          </div>
          {l.status === "confirmed" && (
            <p className="mono-label">The student has confirmed the details. Sign and stamp the printout, then upload the scan.</p>
          )}
          {withdrawing && (
            <>
              <NoteBox value={note} onChange={setNote} placeholder="Why is it withdrawn? Staff see this." rows={2} />
              <div className="flex flex-wrap gap-2">
                <VisaButton
                  disabled={busy || !note.trim()}
                  onClick={() => post(`/api/visas/letters/${l.id}/withdraw`, { note }).then((ok) => ok && setWithdrawing(false))}
                >
                  Withdraw letter
                </VisaButton>
                <VisaButton tone="outline" onClick={() => setWithdrawing(false)}>
                  Cancel
                </VisaButton>
              </div>
            </>
          )}
          <ErrorLine error={error} />
        </div>
      )}
    </li>
  );
}

function IssueForm({
  caseId,
  templates,
  initial,
  stayFrom,
  stayTo,
  defaults,
  onDone,
}: {
  caseId: string;
  templates: IssuableTemplate[];
  initial: string;
  stayFrom: string | null;
  stayTo: string | null;
  defaults: Record<string, string>;
  onDone: () => void;
}) {
  const { post, busy, error, setError } = useVisaPost();
  const [templateId, setTemplateId] = useState(templates.some((t) => t.id === initial) ? initial : templates[0].id);
  const [letterDate, setLetterDate] = useState(today());
  const [values, setValues] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const t = templates.find((x) => x.id === templateId) ?? templates[0];

  const valueOf = (key: string) =>
    values[key] ?? (key === "visa_from" ? stayFrom ?? "" : key === "visa_to" ? stayTo ?? "" : defaults[key] ?? "");
  const inputs = () => {
    const out: Record<string, string | boolean> = {};
    for (const f of t.fields) if (valueOf(f.key).trim()) out[f.key] = valueOf(f.key).trim();
    for (const s of t.sections) out[s.key] = ticked[s.key] === true;
    return out;
  };
  const body = () => ({ template_id: t.id, letter_date: letterDate, inputs: inputs() });

  async function showPreview() {
    setPreviewing(true);
    setError(null);
    const res = await fetch(`/api/visas/cases/${caseId}/letters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body(), preview: true }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setPreviewing(false);
    if (!res || !res.ok) {
      setPreview(null);
      return setError(json.missing ? `${json.error}: ${json.missing.join(", ")}` : json.error ?? "Couldn't fill the letter in");
    }
    setPreview(json.text as string);
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="mono-label">Letter</span>
        <select
          value={t.id}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setPreview(null);
          }}
          className="min-h-11 border border-rule-strong bg-white px-2 text-[14px]"
        >
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {letterName(x)} (version {x.version})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="mono-label">Date of the letter</span>
        <input
          type="date"
          value={letterDate}
          onChange={(e) => {
            setLetterDate(e.target.value);
            setPreview(null);
          }}
          className="min-h-11 border border-rule-strong px-2 text-[14px]"
        />
      </label>
      {t.fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="mono-label">{f.label}</span>
          <input
            type={f.date ? "date" : "text"}
            value={valueOf(f.key)}
            maxLength={300}
            onChange={(e) => {
              setValues({ ...values, [f.key]: e.target.value });
              setPreview(null);
            }}
            className="min-h-11 border border-rule-strong px-2 text-[14px]"
          />
        </label>
      ))}
      {t.sections.map((s) => (
        <label key={s.key} className="flex min-h-11 items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={ticked[s.key] === true}
            onChange={(e) => {
              setTicked({ ...ticked, [s.key]: e.target.checked });
              setPreview(null);
            }}
            className="h-5 w-5"
          />
          {s.label}
        </label>
      ))}

      {preview && (
        <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap border border-rule bg-bone px-4 py-3 text-[13px] leading-relaxed">
          {preview.replaceAll("{{passport_number}}", "[passport number]").replaceAll("[[signature_space]]", "\n[signature and stamp]\n")}
        </div>
      )}
      <p className="mono-label">
        The student checks the details before you sign. Issuing replaces any live {LETTER_KIND_LABEL[t.kind].toLowerCase()}
        {t.school ? ` for ${t.school}` : ""} on this case.
      </p>
      <div className="flex flex-wrap gap-2">
        <VisaButton tone="outline" disabled={previewing} onClick={() => void showPreview()}>
          {previewing ? "Filling in…" : "Preview"}
        </VisaButton>
        <VisaButton
          disabled={busy || !preview}
          onClick={() => post(`/api/visas/cases/${caseId}/letters`, body()).then((ok) => ok && onDone())}
        >
          Issue letter
        </VisaButton>
        <VisaButton tone="outline" onClick={onDone}>
          Cancel
        </VisaButton>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// STUDENT
// ────────────────────────────────────────────────────────────

export function StudentLettersPanel({ letters }: { letters: LetterRow[] }) {
  const current = letters.filter(live);
  if (current.length === 0) return null;
  return (
    <div className="border border-ink">
      <SectionBar title="Your letters" />
      <ul className="px-5 md:px-6">
        {current.map((l) => (
          <StudentLetter key={l.id} letter={l} />
        ))}
      </ul>
    </div>
  );
}

function StudentLetter({ letter: l }: { letter: LetterRow }) {
  const { post, busy, error } = useVisaPost();
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState("");

  return (
    <li className="border-b border-rule py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-[14px] font-semibold">{letterName(l)}</div>
        <StatusPill tone={l.status === "signed" ? "good" : l.status === "with_student" ? "warn" : "quiet"}>
          {STUDENT_LABEL[l.status]}
        </StatusPill>
      </div>

      {l.status === "with_student" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[14px]">
            Open the letter and check your name, passport number, country and dates exactly as they are in your passport.
            FFSA signs it once you confirm.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/visas/letters/${l.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center border border-ink bg-white px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
            >
              Open to check
            </a>
            {!wrong && (
              <>
                <VisaButton disabled={busy} onClick={() => post(`/api/visas/letters/${l.id}/confirm`, { ok: true })}>
                  The details are right
                </VisaButton>
                <VisaButton tone="outline" onClick={() => setWrong(true)}>
                  Something&apos;s wrong
                </VisaButton>
              </>
            )}
          </div>
          {wrong && (
            <>
              <NoteBox value={note} onChange={setNote} placeholder="What's wrong? For example: my surname is spelt Smit, not Smith." rows={2} />
              <p className="text-[13px] text-[#55524A]">
                If the passport number is wrong, say so, but don&apos;t type the number here. Legal will sort it out with you.
              </p>
              <div className="flex flex-wrap gap-2">
                <VisaButton
                  disabled={busy || !note.trim()}
                  onClick={() => post(`/api/visas/letters/${l.id}/confirm`, { ok: false, note }).then((ok) => ok && setWrong(false))}
                >
                  Send to legal
                </VisaButton>
                <VisaButton tone="outline" onClick={() => setWrong(false)}>
                  Cancel
                </VisaButton>
              </div>
            </>
          )}
        </div>
      )}
      {l.status === "needs_fix" && (
        <p className="mt-2 text-[14px]">
          You told legal: &ldquo;{l.student_note}&rdquo;. A corrected letter will appear here for you to check.
        </p>
      )}
      {l.status === "confirmed" && (
        <p className="mt-2 text-[14px]">You confirmed the details. FFSA will sign and stamp the letter and put it here.</p>
      )}
      {l.status === "signed" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[14px]">Signed and stamped. Download it and take it with your visa application.</p>
          <div>
            <VisaButton onClick={() => openVisaLetterScan(l.id)}>Download signed letter</VisaButton>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </li>
  );
}
