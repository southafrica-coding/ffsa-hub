// Reads a post from the Slack "Maintenance Requests" workflow into an item.
//
// The workflow posts (as mrkdwn) something like:
//
//   A maintenance request has been submitted -
//   *Describe the issue or maintenance request*
//   No hot water for couple weeks
//   *Location*
//   A6
//   *Thanks for submitting your request. Maintenance will be notified.*
//   <@U08ER08KV7U>                ← who gets notified, NOT who asked
//   *What is your name?*
//   <@U0ACQAX4K4P>                ← who asked
//
// Headings are matched loosely (case, punctuation) so small wording edits to
// the form don't stop the import. Returns null for anything that isn't a
// request (joins, chatter, other bots).

export type ParsedRequest = {
  issue: string;
  location: string | null;
  requesterSlackId: string | null;
  requesterName: string | null;
};

type RichEl = {
  type?: string;
  text?: string;
  user_id?: string;
  elements?: unknown[];
  style?: { bold?: boolean };
};
type Block = { type?: string; text?: { text?: string }; fields?: { text?: string }[]; elements?: unknown[] };

function walkRich(els: unknown[]): string {
  return els
    .map((e) => {
      const el = e as RichEl;
      if (el.type === "text") return el.style?.bold ? `*${el.text ?? ""}*` : (el.text ?? "");
      if (el.type === "user") return `<@${el.user_id}>`;
      if (Array.isArray(el.elements)) return walkRich(el.elements);
      return "";
    })
    .join("");
}

/** Flatten Block Kit into mrkdwn lines, for posts whose `text` is empty. */
export function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  for (const b of blocks as Block[]) {
    if (b.text?.text) out.push(b.text.text);
    for (const f of b.fields ?? []) if (f.text) out.push(f.text);
    if (b.type === "rich_text" && Array.isArray(b.elements)) out.push(walkRich(b.elements));
  }
  return out.join("\n");
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

function headingKey(line: string): "issue" | "location" | "name" | "other" | null {
  const m = line.trim().match(/^\*(.+)\*$/);
  if (!m) return null;
  const h = norm(m[1]);
  if (h.startsWith("describe")) return "issue";
  if (h.startsWith("location") || h.startsWith("where")) return "location";
  if (h.includes("your name")) return "name";
  return "other";
}

function mention(value: string): { id: string; name: string | null } | null {
  const m = value.match(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/);
  return m ? { id: m[1], name: m[2]?.trim() || null } : null;
}

export function parseMaintenanceRequest(text: string): ParsedRequest | null {
  if (!text) return null;
  const fields: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const key = headingKey(line);
    if (key) {
      current = key;
      fields[key] ??= [];
      continue;
    }
    if (current && current !== "other") fields[current].push(line);
  }
  const value = (k: string) => (fields[k] ?? []).join("\n").trim();
  const issue = value("issue");
  if (!issue) return null;
  const nameRaw = value("name");
  const who = mention(nameRaw);
  return {
    issue,
    location: value("location") || null,
    requesterSlackId: who?.id ?? null,
    requesterName: who ? who.name : nameRaw || null,
  };
}

/** A short title from the issue: its first line, at most 80 characters. */
export function titleFromIssue(issue: string): string {
  const first = issue.split(/\r?\n/).find((l) => l.trim()) ?? issue;
  const clean = first.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}
