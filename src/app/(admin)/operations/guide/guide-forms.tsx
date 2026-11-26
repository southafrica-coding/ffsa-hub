"use client";

// Operations → Guide: the lead's forms. Each posts to /api/operations/guide
// and refreshes the page. Phone first: 44px targets, stacked at 390px.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { guideHref, shortUrl } from "@/lib/operations/guide";
import type { AreaKey } from "@/lib/operations/areas";

const field =
  "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-ink";
const label = "mono-label mb-1.5 block";

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return null;
      }
      return json as { id?: string };
    } catch {
      setError("Couldn't reach the Hub");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, send, router };
}

const Err = ({ error }: { error: string | null }) =>
  error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null;

// ── A How-we-do-it page ─────────────────────────────────────

export function PageEditor({ area, page }: { area: AreaKey; page?: { id: string; title: string; body: string; sort: number } }) {
  const { busy, error, send, router } = useSend();
  const [title, setTitle] = useState(page?.title ?? "");
  const [body, setBody] = useState(page?.body ?? "");
  const [sort, setSort] = useState(String(page?.sort ?? 0));

  async function save() {
    const r = page
      ? await send(`/api/operations/guide/pages/${page.id}`, "PATCH", { title, body, sort: Number(sort) || 0 })
      : await send("/api/operations/guide/pages", "POST", { area, title, body, sort: Number(sort) || 0 });
    if (r) {
      router.push(guideHref(area, page?.id ?? r.id));
      router.refresh();
    }
  }

  async function remove() {
    if (!page || !confirm(`Remove "${page.title}" from the guide? Its earlier versions go with it.`)) return;
    if (await send(`/api/operations/guide/pages/${page.id}`, "DELETE")) {
      router.push(guideHref(area));
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
        <div>
          <label className={label} htmlFor="guide-title">Title</label>
          <input id="guide-title" className={field} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="guide-sort">Position</label>
          <input id="guide-sort" className={field} type="number" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="guide-body">Text</label>
        <textarea
          id="guide-body"
          className={`${field} min-h-[50vh] font-mono text-[13px] leading-relaxed`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="mt-1.5 text-[12px] text-[color:var(--text-tertiary)]">
          ## at the start of a line makes a heading · - makes a list · 1. makes a numbered list · a blank line starts a new
          paragraph · paste a link as it is, or write [words](https://…). Every save is kept.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !title.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => router.push(guideHref(area, page?.id))}>Cancel</Button>
        {page && (
          <Button variant="outline" disabled={busy} onClick={remove} className="ml-auto">Remove page</Button>
        )}
      </div>
      <Err error={error} />
    </div>
  );
}

// ── Resources ───────────────────────────────────────────────

type LinkData = { id: string; section: string | null; title: string; url: string | null; note: string | null; sort: number };

export function LinkRow({ link, canEdit }: { link: LinkData; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="px-5 py-4 md:px-8">
        <LinkForm link={link} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="grid gap-1 px-5 py-3 md:grid-cols-[1fr_auto] md:gap-4 md:px-8">
      <div className="min-w-0">
        {link.url ? (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold underline underline-offset-2">
            {link.title}
          </a>
        ) : (
          <span className="text-[15px] font-semibold">{link.title}</span>
        )}
        {link.url && <span className="ml-2 text-[12px] text-[color:var(--text-tertiary)]">{shortUrl(link.url)}</span>}
        {link.note && <p className="mt-1 whitespace-pre-line text-[14px] text-[color:var(--text-secondary)]">{link.note}</p>}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-11 self-start font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline underline-offset-2"
        >
          Edit
        </button>
      )}
    </li>
  );
}

export function LinkForm({
  area,
  link,
  sections = [],
  onDone,
}: {
  area?: AreaKey;
  link?: LinkData;
  sections?: string[];
  onDone?: () => void;
}) {
  const { busy, error, send, router } = useSend();
  const [v, setV] = useState({
    section: link?.section ?? "",
    title: link?.title ?? "",
    url: link?.url ?? "",
    note: link?.note ?? "",
    sort: String(link?.sort ?? 0),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const id = link?.id ?? "new";

  async function save() {
    const body = { ...v, sort: Number(v.sort) || 0 };
    const r = link
      ? await send(`/api/operations/guide/links/${link.id}`, "PATCH", body)
      : await send("/api/operations/guide/links", "POST", { ...body, area });
    if (r) {
      if (!link) setV({ section: v.section, title: "", url: "", note: "", sort: v.sort });
      onDone?.();
      router.refresh();
    }
  }

  async function remove() {
    if (!link || !confirm(`Remove "${link.title}" from the resources?`)) return;
    if (await send(`/api/operations/guide/links/${link.id}`, "DELETE")) {
      onDone?.();
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`l-title-${id}`}>Name</label>
          <input id={`l-title-${id}`} className={field} value={v.title} onChange={set("title")} />
        </div>
        <div>
          <label className={label} htmlFor={`l-section-${id}`}>Group</label>
          <input id={`l-section-${id}`} className={field} value={v.section} onChange={set("section")} list={`l-sections-${id}`} placeholder="e.g. Communication to leaders" />
          <datalist id={`l-sections-${id}`}>
            {sections.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>
      <div>
        <label className={label} htmlFor={`l-url-${id}`}>Link</label>
        <input id={`l-url-${id}`} className={field} value={v.url} onChange={set("url")} inputMode="url" placeholder="https://…" />
      </div>
      <div>
        <label className={label} htmlFor={`l-note-${id}`}>When and why it&apos;s used</label>
        <textarea id={`l-note-${id}`} className={`${field} min-h-24`} value={v.note} onChange={set("note")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !v.title.trim()} onClick={save}>{busy ? "Saving…" : link ? "Save" : "Add"}</Button>
        {link && <Button variant="outline" disabled={busy} onClick={onDone}>Cancel</Button>}
        {link && <Button variant="outline" disabled={busy} onClick={remove} className="ml-auto">Remove</Button>}
      </div>
      <Err error={error} />
    </div>
  );
}
