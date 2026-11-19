"use client";

// One checklist point (the Fleet app's itemHTML), its "Why and how" help (helpHTML), and
// the small photo pieces the inspection uses. One tap per point: the four result buttons
// are each a quarter of the row, 48px high.

import { useState } from "react";
import checklistContent from "@/lib/fleet/content/checklist.json";
import { StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { fmtDate, plural, STATUS, type AttentionItem, type ConditionEntry } from "@/lib/fleet/rules";
import type { DraftResult, Measure } from "@/lib/fleet/inspection";
import { fileUrl } from "../../_components/ui";

// ── Help ───────────────────────────────────────────────────

interface Help {
  why?: string;
  safetyFirst?: string;
  howToCheck?: string[];
  markOk?: string;
  markMonitor?: string;
  markFixNow?: string;
  looksLike?: string;
  whatGoesWrong?: { problem: string; signs: string }[];
}
const HELP: Record<string, Help> = Object.fromEntries(
  (checklistContent.items as { id: string; help?: Help | null }[]).filter((it) => it.help).map((it) => [it.id, it.help as Help])
);
export const hasHelp = (id: string) => !!HELP[id];

export const STATE_TONE: Record<string, "good" | "warn" | "bad" | "quiet"> = { ok: "good", mon: "warn", fix: "bad", na: "quiet" };

const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="mono-label mb-1 !text-ink">{children}</h4>;

/** "Why and how": why it matters, safety, what it should look like, how to check, what
 *  can go wrong, the note for this model, and how to mark it. */
export function PointHelp({ id, vehicleName, note }: { id: string; vehicleName: string; note?: string }) {
  const g = HELP[id];
  if (!g) return null;
  const res = (
    [
      ["ok", "OK", g.markOk],
      ["mon", "Monitor", g.markMonitor],
      ["fix", "Fix now", g.markFixNow],
    ] as const
  ).filter((x) => x[2]);
  return (
    <div className="space-y-3 border-t border-rule pt-3 text-[14px] leading-relaxed text-[#2B2A26]">
      {g.why && (
        <div>
          <H4>Why it matters</H4>
          <p>{g.why}</p>
        </div>
      )}
      {g.safetyFirst && (
        <p className="border-l-4 border-destructive bg-bone-2 px-3 py-2">
          <strong>Safety first:</strong> {g.safetyFirst}
        </p>
      )}
      {g.looksLike && (
        <div>
          <H4>What it should look like</H4>
          <p>{g.looksLike}</p>
        </div>
      )}
      {g.howToCheck && g.howToCheck.length > 0 && (
        <div>
          <H4>How to check</H4>
          <ol className="list-decimal space-y-1 pl-5">
            {g.howToCheck.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      )}
      {g.whatGoesWrong && g.whatGoesWrong.length > 0 && (
        <div>
          <H4>What can go wrong, and the signs</H4>
          <dl className="space-y-1.5">
            {g.whatGoesWrong.map((f, i) => (
              <div key={i}>
                <dt className="font-semibold">{f.problem}</dt>
                <dd>{f.signs}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {note && (
        <p className="border-l-4 border-ink bg-bone px-3 py-2">
          <strong>On {vehicleName}:</strong> {note}
        </p>
      )}
      {res.length > 0 && (
        <div>
          <H4>How to mark it</H4>
          <dl className="space-y-1.5">
            {res.map(([k, l, t]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0">
                  <StatusPill tone={STATE_TONE[k]}>{l}</StatusPill>
                </dt>
                <dd>{t}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

// ── Photos ─────────────────────────────────────────────────

export function Thumbs({ ids, caption, onRemove }: { ids?: string[]; caption: string; onRemove?: (id: string) => void }) {
  if (!ids || !ids.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <span key={id} className="relative block h-20 w-20 border border-rule bg-bone">
          <a href={fileUrl(id)} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(id)} alt={caption} loading="lazy" className="h-full w-full object-cover" />
          </a>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label="Remove photo"
              className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center border border-ink bg-white text-[16px] leading-none"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** A file picker that looks like a button (the app's .uplabel). */
export function UploadButton({
  label,
  accept = "image/*",
  multiple,
  busy,
  onFiles,
  className,
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center justify-center border border-ink bg-white px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone",
        busy && "pointer-events-none opacity-60",
        className
      )}
    >
      {busy ? "Uploading…" : label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

// ── The point ──────────────────────────────────────────────

const ATT_LABEL: Record<string, string> = { damage: "Damage", repair: "Recent repair", issue: "Known problem", fix: "Fix now", mon: "Monitor" };
export const attLabel = (k: string) => ATT_LABEL[k] || "Note";

const BTN_ON: Record<string, string> = {
  ok: "border-grass bg-grass text-white",
  mon: "border-amber-border bg-amber-border text-ink",
  fix: "border-destructive bg-destructive text-white",
  na: "border-[#55524A] bg-[#55524A] text-white",
};
const EDGE: Record<string, string> = { ok: "border-l-grass", mon: "border-l-amber-border", fix: "border-l-destructive", na: "border-l-rule-strong" };

function moreLabel(r: DraftResult) {
  const n = (r.p || []).length;
  if (!n && !r.n) return "Add note or photo";
  return [r.n ? "Note" : "", n ? plural(n, "photo") : ""].filter(Boolean).join(" · ");
}

export interface PointItem {
  id: string;
  t: string;
  h?: string;
  m?: Measure;
}

export function Point({
  it,
  r,
  open,
  guided,
  attn,
  last,
  vehicleName,
  modelNote,
  uploading,
  onStatus,
  onMeasure,
  onNote,
  onToggleMore,
  onPhotos,
  onRemovePhoto,
}: {
  it: PointItem;
  r: DraftResult;
  /** The note and photo panel (open by default when the point has a note or photo). */
  open: boolean;
  guided?: boolean;
  attn?: AttentionItem[];
  last?: ConditionEntry;
  vehicleName: string;
  modelNote?: string;
  uploading?: boolean;
  onStatus: (s: string) => void;
  onMeasure: (v: string) => void;
  onNote: (n: string) => void;
  onToggleMore: () => void;
  onPhotos: (files: File[]) => void;
  onRemovePhoto: (id: string) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const s = r.s || "";
  const showMore = open;
  const lastFlag = last && (last.s === "fix" || last.s === "mon") ? last : null;
  return (
    <div className={cn("border-l-4 bg-white", s ? EDGE[s] : "border-l-transparent", guided ? "" : "border-b border-b-rule px-4 py-4 md:px-6")}>
      <div className="space-y-1.5">
        <p className="text-[16px] font-semibold leading-snug text-ink">{it.t}</p>
        {it.h && <p className="text-[13px] text-[#55524A]">{it.h}</p>}
        {attn && attn.length > 0 && (
          <div className="space-y-1 border-l-4 border-amber-border bg-bone-2 px-3 py-2 text-[13px]">
            {attn.map((a, i) => (
              <p key={i}>
                <strong>
                  {attLabel(a.k)}
                  {a.d ? ` (${fmtDate(a.d)})` : ""}:
                </strong>{" "}
                {a.t}
              </p>
            ))}
          </div>
        )}
        {lastFlag && (
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-[#55524A]">
            <StatusPill tone={STATE_TONE[lastFlag.s!]}>{STATUS[lastFlag.s!]}</StatusPill>
            <span>
              at the last check{lastFlag.d ? ` (${fmtDate(lastFlag.d)})` : ""}
              {lastFlag.n ? `: ${lastFlag.n}` : ""}
            </span>
          </p>
        )}
        {!guided && hasHelp(it.id) && (
          <button
            type="button"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((o) => !o)}
            className="min-h-11 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink underline underline-offset-4"
          >
            {helpOpen ? "Hide why and how" : "Why and how"}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {it.m && (
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="text"
              inputMode="decimal"
              value={r.v ?? ""}
              onChange={(e) => onMeasure(e.target.value)}
              aria-label={`${it.t} in ${it.m.u}`}
              placeholder="0.0"
              className="min-h-12 w-28 border border-rule-strong bg-white px-3 text-[18px] tabular-nums focus:border-ink focus:outline-none"
            />
            <span className="font-mono text-[12px] font-bold">{it.m.u}</span>
          </label>
        )}
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Result: ${it.t}`}>
          {Object.entries(STATUS).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={s === k}
              onClick={() => onStatus(k)}
              className={cn(
                "min-h-12 border px-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em]",
                s === k ? BTN_ON[k] : "border-rule-strong bg-white text-ink hover:border-ink"
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={showMore}
          onClick={onToggleMore}
          className={cn(
            "min-h-11 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline underline-offset-4",
            r.n || (r.p && r.p.length) ? "text-ink" : "text-[#55524A]"
          )}
        >
          {moreLabel(r)}
        </button>
      </div>

      {(guided || helpOpen) && hasHelp(it.id) && (
        <div className="mt-3">
          <PointHelp id={it.id} vehicleName={vehicleName} note={modelNote} />
        </div>
      )}

      {showMore && (
        <div className="mt-3 space-y-2 border-t border-rule pt-3">
          <textarea
            data-note={it.id}
            rows={2}
            value={r.n || ""}
            onChange={(e) => onNote(e.target.value)}
            placeholder="What did you see or hear?"
            aria-label={`Note: ${it.t}`}
            className="w-full border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none"
          />
          <Thumbs ids={r.p} caption={it.t} onRemove={onRemovePhoto} />
          <UploadButton label="Add photo" multiple busy={uploading} onFiles={onPhotos} />
        </div>
      )}
    </div>
  );
}
