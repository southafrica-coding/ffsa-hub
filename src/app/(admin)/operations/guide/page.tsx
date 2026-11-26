import Link from "next/link";
import { Masthead, MastheadAction, SectionBar } from "@/components/ffsa";
import { AREAS, areaLabel, isAreaKey, type AreaKey } from "@/lib/operations/areas";
import { guideHref, hubChanges, hubPages, parseBody, spans, type Block } from "@/lib/operations/guide";
import { cn } from "@/lib/utils/cn";
import { getPage, isAreaLead, listLinks, listPages, listVersions } from "@/services/ops-guide";
import { areaHref } from "../area-tabs";
import { opsContext } from "../context";
import { LinkForm, LinkRow, PageEditor } from "./guide-forms";

export const dynamic = "force-dynamic";

// Operations → Guide (docs/operations-plan.md, migration 404). One guide per
// area: How we do it (the lead writes it here), Resources, and How the Hub
// does it (kept with the code). Everyone in Operations reads it.

type PageRow = { id: string; title: string; sort: number; updated_at: string };
type LinkRowData = { id: string; section: string | null; title: string; url: string | null; note: string | null; sort: number };
type Version = { id: number; title: string; body: string; edited_at: string; by: { display_name: string | null } | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function OperationsGuidePage({ searchParams }: { searchParams: Promise<{ area?: string; part?: string; edit?: string }> }) {
  const sp = await searchParams;
  const area: AreaKey = isAreaKey(sp.area) ? sp.area : "maintenance";
  const { supabase } = await opsContext({ teamOnly: true });

  const [lead, { data: pageRows }, { data: linkRows }] = await Promise.all([
    isAreaLead(supabase, area),
    listPages(supabase, area),
    listLinks(supabase, area),
  ]);
  const pages = (pageRows ?? []) as PageRow[];
  const links = (linkRows ?? []) as LinkRowData[];
  const hub = hubPages(area);
  const changes = hubChanges(area);

  // Which part is open: a How-we-do-it page, Resources, a Hub page, What's new, or a new page.
  const part = sp.part ?? pages[0]?.id ?? (links.length ? "resources" : hub[0] ? `hub-${hub[0].id}` : "changes");
  const ownPage = pages.find((p) => p.id === part);
  const hubPage = part.startsWith("hub-") ? hub.find((p) => `hub-${p.id}` === part) : undefined;

  const [{ data: page }, { data: versionRows }] = ownPage
    ? await Promise.all([getPage(supabase, ownPage.id), listVersions(supabase, ownPage.id)])
    : [{ data: null }, { data: null }];
  const versions = (versionRows ?? []) as Version[];
  const editing = lead && (part === "new" || (!!page && sp.edit === "1"));

  const sections = [...new Set(links.map((l) => l.section ?? ""))];

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Operations · Guide"
        title={`${areaLabel(area)} guide`}
        actions={<MastheadAction href={areaHref(area)}>Back to {areaLabel(area)}</MastheadAction>}
      />

      {/* One guide per area. */}
      <nav className="flex overflow-x-auto border-b border-ink px-5 pt-4 md:px-8" aria-label="Areas">
        {AREAS.map((a) => (
          <Link
            key={a.key}
            href={guideHref(a.key)}
            aria-current={a.key === area ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
              a.key === area ? "bg-ink text-white" : "border border-b-0 border-rule text-[color:var(--text-tertiary)] hover:text-ink"
            )}
          >
            {a.label}
          </Link>
        ))}
      </nav>

      <div className="grid md:grid-cols-[240px_1fr]">
        {/* Contents */}
        <aside className="border-b border-rule bg-bone px-5 py-4 md:min-h-[60vh] md:border-b-0 md:border-r md:px-6">
          <Contents
            title="How we do it"
            items={pages.map((p) => ({ part: p.id, label: p.title }))}
            area={area}
            current={part}
            empty={lead ? "Nothing written yet." : "Nothing written yet. The area's lead writes this part."}
          />
          {lead && (
            <Link href={guideHref(area, "new")} className="mt-1 flex min-h-11 items-center text-[13px] font-semibold underline underline-offset-2">
              + Add a page
            </Link>
          )}
          <Contents title="Resources" items={[{ part: "resources", label: links.length ? `All resources (${links.length})` : "Resources" }]} area={area} current={part} />
          <Contents
            title="How the Hub does it"
            items={[...hub.map((p) => ({ part: `hub-${p.id}`, label: p.title })), { part: "changes", label: "What's new" }]}
            area={area}
            current={part}
          />
        </aside>

        <main className="min-w-0">
          {part === "new" && lead ? (
            <>
              <SectionBar title="New page" />
              <div className="px-5 py-5 md:px-8">
                <PageEditor area={area} />
              </div>
            </>
          ) : page ? (
            <>
              <SectionBar title={page.title} meta={`Updated ${when(page.updated_at)}${page.editor?.display_name ? ` · ${page.editor.display_name}` : ""}`} />
              <div className="px-5 py-5 md:px-8">
                {editing ? (
                  <PageEditor area={area} page={{ id: page.id, title: page.title, body: page.body, sort: page.sort }} />
                ) : (
                  <>
                    <Blocks blocks={parseBody(page.body)} />
                    {lead && (
                      <Link
                        href={`${guideHref(area, page.id)}&edit=1`}
                        className="mt-6 inline-flex min-h-11 items-center border border-ink px-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
                      >
                        Edit this page
                      </Link>
                    )}
                  </>
                )}
              </div>

              <SectionBar title="Earlier versions" meta={`${Math.max(versions.length - 1, 0)}`} />
              {versions.length <= 1 ? (
                <p className="px-5 py-5 text-[13px] text-[color:var(--text-tertiary)] md:px-8">No earlier versions.</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {versions.slice(1).map((v) => (
                    <li key={v.id} className="px-5 py-2 md:px-8">
                      <details>
                        <summary className="flex min-h-11 cursor-pointer items-center text-[13px]">
                          {when(v.edited_at)}
                          {v.by?.display_name ? <span className="text-[color:var(--text-tertiary)]">&nbsp;· {v.by.display_name}</span> : null}
                        </summary>
                        <div className="border-l-2 border-rule-strong py-2 pl-4">
                          <div className="mb-2 font-semibold">{v.title}</div>
                          <Blocks blocks={parseBody(v.body)} />
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : part === "resources" ? (
            <>
              <SectionBar title="Resources" meta="Forms, templates and documents, and when to use each" />
              {links.length === 0 && (
                <p className="px-5 py-5 text-[14px] text-[color:var(--text-tertiary)] md:px-8">No resources yet.</p>
              )}
              {sections.map((s) => (
                <section key={s || "-"}>
                  {s && <div className="mono-label border-b border-rule px-5 pb-2 pt-5 md:px-8">{s}</div>}
                  <ul className="divide-y divide-rule">
                    {links.filter((l) => (l.section ?? "") === s).map((l) => (
                      <LinkRow key={l.id} link={l} canEdit={lead} />
                    ))}
                  </ul>
                </section>
              ))}
              {lead && (
                <div className="border-t border-rule px-5 py-5 md:px-8">
                  <div className="mono-label mb-3">Add a resource</div>
                  <LinkForm area={area} sections={sections.filter(Boolean)} />
                </div>
              )}
            </>
          ) : hubPage ? (
            <>
              <SectionBar title={hubPage.title} meta="How the Hub does it" />
              <div className="px-5 py-5 md:px-8">
                <Blocks blocks={hubPage.blocks} />
              </div>
            </>
          ) : (
            <>
              <SectionBar title="What's new" meta="Changes to the Hub for this area" />
              {changes.length === 0 ? (
                <p className="px-5 py-5 text-[14px] text-[color:var(--text-tertiary)] md:px-8">Nothing in the Hub for this area yet.</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {changes.map(([date, , text], i) => (
                    <li key={i} className="grid gap-0.5 px-5 py-3 text-[14px] md:grid-cols-[120px_1fr] md:gap-4 md:px-8">
                      <span className="font-mono text-[12px] text-[color:var(--text-tertiary)]">{date}</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Contents({
  title,
  items,
  area,
  current,
  empty,
}: {
  title: string;
  items: { part: string; label: string }[];
  area: AreaKey;
  current: string;
  empty?: string;
}) {
  return (
    <div className="mb-4">
      <div className="mono-label mb-1">{title}</div>
      {items.length === 0 && empty ? <p className="py-2 text-[13px] text-[color:var(--text-tertiary)]">{empty}</p> : null}
      <ul>
        {items.map((it) => (
          <li key={it.part}>
            <Link
              href={guideHref(area, it.part)}
              aria-current={it.part === current ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center border-l-2 py-1.5 pl-3 text-[14px]",
                it.part === current ? "border-ink font-semibold text-ink" : "border-transparent text-[color:var(--text-secondary)] hover:text-ink"
              )}
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {spans(text).map((s, i) =>
        "href" in s ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) return <p className="text-[14px] text-[color:var(--text-tertiary)]">This page is empty.</p>;
  return (
    <div className="max-w-2xl space-y-3 text-[15px] leading-relaxed">
      {blocks.map((b, i) =>
        "h" in b ? (
          <h3 key={i} className="pt-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em]">
            <Rich text={b.h} />
          </h3>
        ) : "p" in b ? (
          <p key={i}>
            <Rich text={b.p} />
          </p>
        ) : "ul" in b ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.ul.map((t, j) => (
              <li key={j}>
                <Rich text={t} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.ol.map((t, j) => (
              <li key={j}>
                <Rich text={t} />
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}
