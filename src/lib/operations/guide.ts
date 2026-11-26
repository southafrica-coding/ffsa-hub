// Operations — the guide (migration 404, docs/operations-plan.md).
//
// Two parts per area:
//   How we do it        pages the area's lead writes in the Hub (plain text,
//                       see parseBody) and Resources (links with a note).
//   How the Hub does it content/guide-hub.json, kept with the code: update it
//                       with every change to an Operations area, and add a
//                       dated line to `changes`.

import hubContent from "./content/guide-hub.json";
import { AREA_KEYS, type AreaKey } from "./areas";

// ── The page text ───────────────────────────────────────────
//
// Written in a plain textarea, so the format is what people type anyway:
//   ## Heading           (# works too)
//   - item  /  * item    a list
//   1. item              a numbered list
//   a blank line         starts a new paragraph
// Links: a bare https://… address, or [words](https://…).

export type Block =
  | { h: string }
  | { p: string }
  | { ul: string[] }
  | { ol: string[] };

export function parseBody(body: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ p: para.join(" ") });
    para = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const h = line.match(/^#{1,3}\s+(.*)$/);
    const ul = line.match(/^[-*•]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) {
      flush();
    } else if (h) {
      flush();
      out.push({ h: h[1] });
    } else if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      const text = (ul ?? ol)![1];
      const last = out[out.length - 1] as Record<string, string[]> | undefined;
      if (last && Array.isArray(last[kind])) last[kind].push(text);
      else out.push(kind === "ul" ? { ul: [text] } : { ol: [text] });
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

export type Span = { text: string } | { text: string; href: string };

/** Split a line into text and links. Only http(s) links; nothing else is markup. */
export function spans(line: string): Span[] {
  const out: Span[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let at = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > at) out.push({ text: line.slice(at, m.index) });
    out.push(m[1] ? { text: m[1], href: m[2] } : { text: shortUrl(m[3]), href: m[3] });
    at = m.index! + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

/** "docs.google.com/…" rather than the whole address. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return u.pathname.length > 1 ? `${host}/…` : host;
  } catch {
    return url;
  }
}

// ── Checking what's sent ────────────────────────────────────

export const TITLE_MAX = 120;
export const BODY_MAX = 60000;

type Clean<T> = { ok: true; value: T } | { ok: false; error: string };

export function cleanPage(body: Record<string, unknown>, partial = false): Clean<Record<string, unknown>> {
  const v: Record<string, unknown> = {};
  if (!partial || "title" in body) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return { ok: false, error: "Give the page a title" };
    if (t.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters` };
    v.title = t;
  }
  if (!partial || "body" in body) {
    const b = typeof body.body === "string" ? body.body : "";
    if (b.length > BODY_MAX) return { ok: false, error: "That page is too long — split it in two" };
    v.body = b;
  }
  if ("sort" in body) {
    const s = Number(body.sort);
    if (!Number.isInteger(s)) return { ok: false, error: "Bad position" };
    v.sort = s;
  }
  if (partial && Object.keys(v).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, value: v };
}

const opt = (x: unknown, max: number) => {
  const s = typeof x === "string" ? x.trim() : "";
  return s ? s.slice(0, max) : null;
};

export function cleanLink(body: Record<string, unknown>, partial = false): Clean<Record<string, unknown>> {
  const v: Record<string, unknown> = {};
  if (!partial || "title" in body) {
    const t = opt(body.title, 160);
    if (!t) return { ok: false, error: "Give the resource a name" };
    v.title = t;
  }
  if (!partial || "url" in body) {
    const u = opt(body.url, 2000);
    if (u && !/^https?:\/\//i.test(u)) return { ok: false, error: "The link must start with https://" };
    v.url = u;
  }
  if (!partial || "note" in body) v.note = opt(body.note, 4000);
  if (!partial || "section" in body) v.section = opt(body.section, 120);
  if ("sort" in body) {
    const s = Number(body.sort);
    if (!Number.isInteger(s)) return { ok: false, error: "Bad position" };
    v.sort = s;
  }
  if (partial && Object.keys(v).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, value: v };
}

// ── How the Hub does it ─────────────────────────────────────

export type HubBlock = { h: string } | { p: string } | { ul: string[] };
export type HubPage = { id: string; title: string; blocks: HubBlock[] };
type HubGuide = {
  areas: Partial<Record<AreaKey, HubPage[]>>;
  /** Newest first: [YYYY-MM-DD, area, what changed]. */
  changes: [string, AreaKey, string][];
};

export const HUB_GUIDE = hubContent as unknown as HubGuide;

export const hubPages = (area: AreaKey): HubPage[] => HUB_GUIDE.areas[area] ?? [];
export const hubChanges = (area: AreaKey) => HUB_GUIDE.changes.filter(([, a]) => a === area);

/** Every area key in the Hub guide is a real area; every page id is unique in its area. */
export function hubGuideProblems(g: HubGuide = HUB_GUIDE): string[] {
  const problems: string[] = [];
  for (const [area, pages] of Object.entries(g.areas)) {
    if (!(AREA_KEYS as string[]).includes(area)) problems.push(`unknown area ${area}`);
    const ids = new Set<string>();
    for (const p of pages ?? []) {
      if (ids.has(p.id)) problems.push(`${area}: page ${p.id} twice`);
      ids.add(p.id);
    }
  }
  for (const [date, area] of g.changes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`bad date ${date}`);
    if (!(AREA_KEYS as string[]).includes(area)) problems.push(`unknown area ${area} in changes`);
  }
  return problems;
}

// ── Where things are ────────────────────────────────────────

/** ?part= on the guide page: a How-we-do-it page id, "resources", "hub-<id>" or "new". */
export const guideHref = (area: AreaKey, part?: string) =>
  `/operations/guide?area=${area}${part ? `&part=${encodeURIComponent(part)}` : ""}`;
