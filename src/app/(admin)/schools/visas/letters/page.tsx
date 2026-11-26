import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { getVisaAccess } from "@/lib/visas/access";
import { formatDay } from "@/lib/visas/display";
import { LETTER_KINDS, LETTER_KIND_LABEL, type LetterKind } from "@/lib/visas/letters";
import { getActivePrograms, getProgramNames, getVisaLetterTemplates } from "@/services/visas";

// Legal's letter templates: one row per letter (kind + school), with the
// version in use and any draft. Only global legal edits them (366). The
// wording lives only in the database.

type TemplateRow = {
  id: string;
  kind: LetterKind;
  program_id: string | null;
  version: number;
  title: string;
  status: "draft" | "current" | "retired";
  published_at: string | null;
  updated_at: string;
};

export default async function LetterTemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getVisaAccess(supabase, user.id);
  if (!access.globalLegal) redirect("/schools/visas");

  const [{ data: templateData }, { data: programData }] = await Promise.all([
    getVisaLetterTemplates(supabase),
    getActivePrograms(supabase),
  ]);
  const templates = (templateData ?? []) as TemplateRow[];
  const active = (programData ?? []) as Array<{ id: string; name: string }>;
  const { data: usedPrograms } = await getProgramNames(
    supabase,
    templates.map((t) => t.program_id).filter((id): id is string => !!id)
  );
  const programName = new Map<string, string>(
    [...active, ...((usedPrograms ?? []) as Array<{ id: string; name: string }>)].map((p) => [p.id, p.name])
  );

  // One row per letter: its current version and its draft.
  const rows = new Map<string, { kind: LetterKind; program_id: string | null; current?: TemplateRow; draft?: TemplateRow; title: string }>();
  for (const t of templates) {
    const key = `${t.kind}:${t.program_id ?? ""}`;
    const row = rows.get(key) ?? { kind: t.kind, program_id: t.program_id, title: t.title };
    if (t.status === "current") row.current = t;
    if (t.status === "draft") row.draft = t;
    if (t.status !== "retired") row.title = t.title;
    rows.set(key, row);
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      LETTER_KINDS.indexOf(a.kind) - LETTER_KINDS.indexOf(b.kind) ||
      (programName.get(a.program_id ?? "") ?? "").localeCompare(programName.get(b.program_id ?? "") ?? "")
  );
  const editHref = (kind: string, programId: string | null) =>
    `/schools/visas/letters/edit?kind=${kind}${programId ? `&program=${programId}` : ""}`;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Visas · Legal"
        title="Letter templates"
        actions={
          <Link href="/schools/visas" className="mono-label underline-offset-4 hover:underline">
            All cases
          </Link>
        }
      />
      <div className="flex flex-col gap-6 px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-[720px] text-[14px]">
          FFSA&apos;s visa letters. The Hub fills in each student&apos;s details; nobody changes the wording on a single
          letter. Every change you save is a new version, and a version is only used once you publish it.
        </p>

        <div className="border border-ink">
          <SectionBar title="Letters" meta={`${list.length}`} />
          <ul>
            {list.map((r) => (
              <li key={`${r.kind}:${r.program_id ?? ""}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3 last:border-b-0">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">
                    {LETTER_KIND_LABEL[r.kind]} · {r.program_id ? (programName.get(r.program_id) ?? "School") : "Any school"}
                  </div>
                  <div className="mono-label mt-1">
                    {r.current
                      ? `Version ${r.current.version} in use since ${formatDay(r.current.published_at)}`
                      : "Not published yet"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.draft && <StatusPill tone="warn">Draft v{r.draft.version}</StatusPill>}
                  <Link
                    href={editHref(r.kind, r.program_id)}
                    className="inline-flex min-h-11 items-center border border-ink bg-white px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
                  >
                    {r.draft ? "Edit draft" : "Edit"}
                  </Link>
                </div>
              </li>
            ))}
            {list.length === 0 && (
              <li className="px-5 py-4 text-[14px] text-[#55524A]">
                No letters yet. Start with the invitation letter for each school, then the confirmation of accommodation.
              </li>
            )}
          </ul>
        </div>

        <div className="border border-ink">
          <SectionBar title="Add a letter" />
          <form action="/schools/visas/letters/edit" method="get" className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-end md:px-6">
            <label className="flex flex-col gap-1">
              <span className="mono-label">Letter</span>
              <select name="kind" className="min-h-11 border border-rule-strong bg-white px-2 text-[14px]">
                {LETTER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LETTER_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label">School</span>
              <select name="program" className="min-h-11 border border-rule-strong bg-white px-2 text-[14px]">
                <option value="">Any school (not for invitations)</option>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622]"
            >
              Start
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
