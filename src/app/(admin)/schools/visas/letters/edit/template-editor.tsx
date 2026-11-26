"use client";

// Legal's editor for one letter template. Plain text with {{fields}} the
// Hub fills in and {{#paragraphs}} legal ticks per letter. The problems
// list and the sample preview update as you type; publishing is refused
// (here and in the database) while there are problems.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { ErrorLine, VisaButton } from "@/components/visas/visa-ui";
import { formatDay } from "@/lib/visas/display";
import {
  LETTER_FIELDS,
  LETTER_SECTIONS,
  SIGNATURE_MARK,
  letterValues,
  renderLetter,
  templateProblems,
  type LetterKind,
} from "@/lib/visas/letters";

export interface TemplateVersion {
  id: string;
  version: number;
  title: string;
  body: string;
  status: "draft" | "current" | "retired";
  change_note: string | null;
  published_at: string | null;
  updated_at: string;
}

// The global button style is uppercase; field names are case-sensitive
// ({{he_she}} vs {{He_She}}), so these show them as they are.
const FIELD_NAME_STYLE = { textTransform: "none", letterSpacing: "normal" } as const;

const SOURCE_LABEL: Record<string, string> = {
  letter: "The letter",
  student: "From the student's profile",
  case: "From the case (legal can change them)",
  school: "From the school",
  legal: "Legal fills in when issuing",
};

/** Made-up values so legal can see how the letter reads. */
function sample(school: string | null, ticked: Record<string, boolean>) {
  const inputs: Record<string, string | boolean> = { ...ticked };
  for (const f of LETTER_FIELDS) if (f.source === "legal") inputs[f.key] = f.date ? "2027-03-26" : `[${f.label}]`;
  const values = letterValues({
    letterDate: new Date().toISOString().slice(0, 10),
    student: { first_name: "Sample", last_name: "Student", gender: "Female", nationality: "[country]" },
    stay: { from: "2027-01-10", to: "2027-04-10" },
    schools: [{ name: school ?? "[school]", start_date: "2027-01-12", end_date: "2027-04-08" }],
    inputs,
  });
  return { values, inputs };
}

export function TemplateEditor({
  kind,
  programId,
  school,
  draft,
  current,
  versions,
}: {
  kind: LetterKind;
  programId: string | null;
  school: string | null;
  draft: TemplateVersion | null;
  current: TemplateVersion | null;
  versions: TemplateVersion[];
}) {
  const router = useRouter();
  const start = draft ?? current;
  const [title, setTitle] = useState(start?.title ?? "");
  const [body, setBody] = useState(start?.body ?? "");
  const [note, setNote] = useState(draft?.change_note ?? "");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const problems = templateProblems(kind, body);
  const { values, inputs } = sample(school, ticked);
  const preview = renderLetter(body, values, inputs).text;
  const changed = title !== (start?.title ?? "") || body !== (start?.body ?? "") || note !== (draft?.change_note ?? "");

  function insert(token: string) {
    const el = area.current;
    if (!el) return setBody(body + token);
    const at = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? at;
    const next = body.slice(0, at) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function call(url: string, method: string, payload?: unknown) {
    const res = await fetch(url, {
      method,
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      throw new Error(json.problems ? `${json.error}: ${json.problems.join(" ")}` : json.error ?? "Something went wrong");
    }
    return json;
  }

  async function save(): Promise<string | null> {
    const json = await call("/api/visas/letter-templates", "POST", {
      kind,
      program_id: programId,
      title,
      body,
      change_note: note,
    });
    return json.id as string;
  }

  async function run(action: "save" | "publish" | "discard") {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      if (action === "discard" && draft) {
        await call(`/api/visas/letter-templates/${draft.id}`, "DELETE");
        setTitle(current?.title ?? "");
        setBody(current?.body ?? "");
        setNote("");
        setSaved("Draft thrown away.");
      } else {
        const id = changed || !draft ? await save() : draft.id;
        if (action === "publish" && id) {
          await call(`/api/visas/letter-templates/${id}/publish`, "POST");
          setNote("");
          setSaved("Published. New letters use this version.");
        } else {
          setSaved("Draft saved. It isn't used until you publish it.");
        }
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 px-5 py-6 md:px-8 md:py-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <StatusPill tone="warn">Editing draft v{draft.version}</StatusPill>
          ) : current ? (
            <StatusPill tone="quiet">Version {current.version} in use · saving makes a new draft</StatusPill>
          ) : (
            <StatusPill tone="quiet">New letter</StatusPill>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Title (staff see this; it isn&apos;t printed)</span>
          <input
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Request visa and confirm invitation"
            className="min-h-11 border border-rule-strong px-3 text-[14px] outline-none focus:border-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Letter (a blank line starts a new paragraph)</span>
          <textarea
            ref={area}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={24}
            spellCheck
            className="w-full border border-rule-strong bg-white px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">What changed (optional, kept with the version)</span>
          <input
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-11 border border-rule-strong px-3 text-[14px] outline-none focus:border-ink"
          />
        </label>

        {problems.length > 0 && (
          <div className="border-l-[3px] border-[#8A6400] pl-3">
            <p className="mono-label">Fix before publishing</p>
            <ul className="mt-1 list-disc pl-5 text-[14px]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <VisaButton tone="outline" disabled={busy || !title.trim() || !body.trim() || !changed} onClick={() => void run("save")}>
            Save draft
          </VisaButton>
          <VisaButton disabled={busy || !title.trim() || problems.length > 0 || (!changed && !draft)} onClick={() => void run("publish")}>
            Publish
          </VisaButton>
          {draft && (
            <VisaButton tone="outline" disabled={busy} onClick={() => void run("discard")}>
              Throw draft away
            </VisaButton>
          )}
        </div>
        {saved && <p className="text-[13px] text-[#3E7F2B]">{saved}</p>}
        <ErrorLine error={error} />
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="border border-ink">
          <SectionBar title="Fields" meta="Click to insert" />
          <div className="flex flex-col gap-3 px-5 py-4">
            {Object.keys(SOURCE_LABEL).map((source) => (
              <div key={source}>
                <p className="mono-label">{SOURCE_LABEL[source]}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {LETTER_FIELDS.filter((f) => f.source === source).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      title={f.label}
                      onClick={() => insert(`{{${f.key}}}`)}
                      className="min-h-9 border border-rule-strong bg-white px-2 font-mono text-[11px] hover:border-ink"
                      style={FIELD_NAME_STYLE}
                    >
                      {`{{${f.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <p className="mono-label">Paragraphs legal ticks per letter</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {LETTER_SECTIONS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    title={s.label}
                    onClick={() => insert(`{{#${s.key}}}\n\n{{/${s.key}}}`)}
                    className="min-h-9 border border-rule-strong bg-white px-2 font-mono text-[11px] hover:border-ink"
                      style={FIELD_NAME_STYLE}
                  >
                    {`{{#${s.key}}}…`}
                  </button>
                ))}
              </div>
            </div>
            {kind === "invitation" && (
              <p className="text-[13px] text-[#55524A]">
                Every invitation letter must carry FFSA&apos;s repatriation undertaking. Leave your ID and passport numbers
                off; your certified ID goes in with FFSA&apos;s standing documents.
              </p>
            )}
          </div>
        </div>

        <div className="border border-ink">
          <SectionBar title="Preview" meta="Sample student" />
          {LETTER_SECTIONS.some((s) => body.includes(`{{#${s.key}}}`)) && (
            <div className="flex flex-wrap gap-3 border-b border-rule px-5 py-2">
              {LETTER_SECTIONS.filter((s) => body.includes(`{{#${s.key}}}`)).map((s) => (
                <label key={s.key} className="flex min-h-9 items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={ticked[s.key] === true}
                    onChange={(e) => setTicked({ ...ticked, [s.key]: e.target.checked })}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          )}
          <div className="whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed">
            {preview
              ? preview.replaceAll("{{passport_number}}", "[passport number]").replaceAll(SIGNATURE_MARK, "\n[signature and stamp]\n")
              : "The preview shows here as you write."}
          </div>
        </div>

        {versions.length > 0 && (
          <div className="border border-ink">
            <SectionBar title="Versions" />
            <ul>
              {versions.map((v) => (
                <li key={v.id} className="border-b border-rule px-5 py-2 text-[13px] last:border-b-0">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="mono-label mr-2">v{v.version}</span>
                      {v.status === "current" ? "In use" : v.status === "draft" ? "Draft" : "Retired"}
                      {v.published_at ? ` · published ${formatDay(v.published_at)}` : ` · saved ${formatDay(v.updated_at)}`}
                      {v.change_note ? ` · ${v.change_note}` : ""}
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap border-l-[3px] border-rule-strong pl-3 font-mono text-[12px]">{v.body}</div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
