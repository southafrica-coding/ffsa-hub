/**
 * "What is the user looking at?" — turns the current URL into a short
 * description for the assistant, so "how is this event selling?" works
 * without the user naming the event.
 *
 * Record lookups use the user's own client (RLS) and only run when the
 * user can open that module. Anything we can't load is simply skipped.
 */

import { ADMIN_MODULES, SYSTEM_MODULES, PORTAL_TABS } from "@/config/modules";
import { getEventById } from "@/services/events";
import { getContactById } from "@/services/contacts";
import { getProgramById } from "@/services/schools";
import { canUseModule, type AssistantAccess } from "./access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function sectionFor(pathname: string): string | null {
  const all = [
    ...ADMIN_MODULES.map((m) => ({ href: m.href, label: m.label })),
    ...SYSTEM_MODULES.map((m) => ({ href: m.href, label: m.label })),
    ...PORTAL_TABS.map((t) => ({ href: t.href, label: t.label })),
  ];
  const match = all
    .filter((m) => pathname === m.href || pathname.startsWith(m.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? null;
}

async function describeRecord(
  db: Client,
  pathname: string,
  access: AssistantAccess
): Promise<string | null> {
  let m = pathname.match(new RegExp(`^/events/(${UUID})`, "i"));
  if (m && canUseModule(access, "events")) {
    const { data: e } = await getEventById(db, m[1]);
    if (!e) return null;
    return [
      `Event: "${e.title}"`,
      `Dates: ${e.start_date ?? "?"}${e.end_date && e.end_date !== e.start_date ? ` to ${e.end_date}` : ""}${e.start_time ? ` from ${e.start_time}` : ""}`,
      `Status: ${e.status ?? "?"} · Location: ${e.location ?? "—"} · Capacity: ${e.max_capacity ?? "—"}`,
      `Ticketing: ${e.ticketing_enabled ? "on" : "off"} · Public: ${e.is_public ? "yes" : "no"}`,
    ].join("\n");
  }

  m = pathname.match(new RegExp(`^/contacts/(${UUID})`, "i"));
  if (m && canUseModule(access, "contacts")) {
    const { data: c } = await getContactById(db, m[1]);
    if (!c) return null;
    const name = `${c.preferred_name || c.first_name || ""} ${c.last_name ?? ""}`.trim();
    return [
      `Contact: ${name}`,
      `Email: ${c.email ?? "—"} · Phone: ${c.phone ?? "—"}`,
      `Status: ${c.status ?? "—"} · Marketing: ${c.marketing_status ?? "—"} · Source: ${c.source ?? "—"}`,
      `City: ${c.city ?? "—"} · Added: ${c.created_at?.slice(0, 10) ?? "—"} · Last interaction: ${c.last_interaction_at?.slice(0, 10) ?? "—"}`,
      c.notes ? `Notes: ${String(c.notes).slice(0, 500)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  m = pathname.match(new RegExp(`^/schools/(${UUID})`, "i"));
  if (m && canUseModule(access, "schools")) {
    const { data: p } = await getProgramById(db, m[1]);
    if (!p) return null;
    return [
      `Training program: ${p.name} (${p.code})`,
      `Status: ${p.status ?? "—"} · Applications open: ${p.application_open ? "yes" : "no"} · Deadline: ${p.application_deadline ?? "—"}`,
      `Courses: ${(p.courses ?? []).length}`,
    ].join("\n");
  }

  return null;
}

export async function describePage(
  db: Client,
  pathname: string,
  access: AssistantAccess
): Promise<string> {
  const lines = [`Current page: ${pathname}`];
  const section = sectionFor(pathname);
  if (section) lines.push(`Hub section: ${section}`);
  try {
    const record = await describeRecord(db, pathname, access);
    if (record) lines.push(record);
  } catch {
    /* best-effort */
  }
  return lines.join("\n");
}
