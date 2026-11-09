"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { lmsCall, lmsMessage, summaryLine, type DesignSummary } from "@/lib/schools/lms-api";
import { Notice, SquareButton } from "./fields";

type TemplateRow = {
  id: string;
  program_id: string | null;
  name: string;
  description: string | null;
  updated_at?: string | null;
  summary: DesignSummary | null;
};

export function TemplateLibrary({
  programId,
  programName,
  canSaveBaseWide,
}: {
  programId: string;
  programName: string;
  canSaveBaseWide: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    lmsCall<{ templates: TemplateRow[] }>(`/api/schools/course-templates?program_id=${programId}`)
      .then((body) => {
        setRows(body.templates ?? []);
        setError(null);
      })
      .catch((caught) => {
        setRows([]);
        setError(lmsMessage(caught));
      });
  }

  useEffect(() => {
    load();
    // load is recreated each render; the library only needs the program id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  async function remove(row: TemplateRow) {
    if (row.program_id == null && !canSaveBaseWide) return;
    if (!confirm(`Delete the template “${row.name}”? Courses that already copied it keep their own classroom.`)) return;
    setBusyId(row.id);
    try {
      await lmsCall(`/api/schools/course-templates/${row.id}`, { method: "DELETE" });
      setRows((current) => (current ?? []).filter((item) => item.id !== row.id));
      router.refresh();
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  const school = (rows ?? []).filter((row) => row.program_id === programId);
  const shared = (rows ?? []).filter((row) => row.program_id == null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4 md:px-8">
        <p className="max-w-xl text-[13px] leading-snug text-[#55524A]">
          A template is a classroom you can copy onto a course in {programName}. Copying takes a snapshot. Later edits
          to the template do not rewrite the course.
        </p>
        <Link
          href={`/schools/${programId}/classroom/templates/new`}
          className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
        >
          New template
        </Link>
      </div>
      {error ? (
        <div className="px-5 py-4 md:px-8">
          <Notice tone="warn">{error}</Notice>
        </div>
      ) : null}
      {rows === null ? (
        <p className="px-5 py-8 mono-label md:px-8">Loading templates…</p>
      ) : (
        <>
          <TemplateGroup title="This school" rows={school} busyId={busyId} programId={programId} canChange={() => true} onDelete={remove} />
          <TemplateGroup
            title="Every school"
            rows={shared}
            busyId={busyId}
            programId={programId}
            canChange={() => canSaveBaseWide}
            onDelete={remove}
          />
        </>
      )}
    </div>
  );
}

function TemplateGroup({
  title,
  rows,
  programId,
  busyId,
  canChange,
  onDelete,
}: {
  title: string;
  rows: TemplateRow[];
  programId: string;
  busyId: string | null;
  canChange: (row: TemplateRow) => boolean;
  onDelete: (row: TemplateRow) => void;
}) {
  return (
    <section>
      <SectionBar title={title} meta={`${rows.length}`} />
      {rows.length === 0 ? (
        <p className="border-b border-rule px-5 py-8 text-[13px] text-[#55524A] md:px-8">Nothing saved here yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 border-b border-rule px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[18px] font-black uppercase leading-none">{row.name}</span>
                  {row.program_id == null ? <StatusPill>Every school</StatusPill> : null}
                </div>
                <p className="mono-label mt-1.5">{summaryLine(row.summary)}</p>
                {row.description ? <p className="mt-1 text-[13px] text-[#55524A]">{row.description}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {canChange(row) ? (
                  <Link
                    href={`/schools/${programId}/classroom/templates/${row.id}`}
                    className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
                  >
                    Edit
                  </Link>
                ) : null}
                {canChange(row) ? (
                  <SquareButton tone="quiet" disabled={busyId === row.id} onClick={() => onDelete(row)}>
                    Delete
                  </SquareButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
