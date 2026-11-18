import type { MissioCampus, MissioMe, MissioStatus } from "./types-shim";

export const DEFAULT_PEOPLE_LIMIT = 50;
export const MAX_PEOPLE_LIMIT = 200;

export const CAMPUS_LABEL: Record<MissioCampus, string> = {
  potch: "Missio Potch",
  jhb: "Missio JHB",
};

export const STATUS_LABEL: Record<MissioStatus, string> = {
  visitor: "Visitor",
  active: "Active",
  inactive: "Inactive",
};

const ORG_ORDER = ["ffsa", "missio"];

export interface PeopleQuery {
  campus?: MissioCampus | "";
  status?: MissioStatus | "";
  q?: string;
  limit?: number;
  offset?: number;
}

export type OrgSkin = "ffsa" | "missio";

/** The switcher is shown only when the viewer belongs to more than one org. */
export function shouldShowOrgSwitcher(orgCount: number): boolean {
  return orgCount > 1;
}

/** Picking Missio re-skins; every other slug keeps the FFSA look. */
export function skinForOrg(slug: string): OrgSkin {
  return slug === "missio" ? "missio" : "ffsa";
}

/**
 * Phase 0 gate. `currentOrg` is `"missio"` for any Missio role, so this
 * still requires `rolesByOrg.missio` to include `pastor`. An FFSA role
 * never satisfies that check.
 */
export function canAccessMissio(me: MissioMe): boolean {
  if (me.currentOrg !== "missio") return false;
  const roles = me.rolesByOrg.missio ?? [];
  return roles.includes("pastor");
}

export function sortOrgs<T extends { slug: string }>(orgs: T[]): T[] {
  return orgs.slice().sort((a, b) => orgRank(a.slug) - orgRank(b.slug));
}

function orgRank(slug: string): number {
  const index = ORG_ORDER.indexOf(slug);
  return index === -1 ? ORG_ORDER.length : index;
}

/** Where the switcher sends someone for an organisation slug. */
export function orgHref(slug: string): string {
  return slug === "missio" ? "/missio" : "/dashboard";
}

export function clampPeopleLimit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 1) return DEFAULT_PEOPLE_LIMIT;
  return Math.min(MAX_PEOPLE_LIMIT, Math.floor(value));
}

/** Query string for GET /api/missio/people. Empty filters are omitted. `q` is a name. */
export function peopleSearchParams(query: PeopleQuery = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.campus === "potch" || query.campus === "jhb") params.set("campus", query.campus);
  if (query.status === "visitor" || query.status === "active" || query.status === "inactive") {
    params.set("status", query.status);
  }
  const q = query.q?.trim();
  if (q) params.set("q", q);
  const offset = query.offset == null || !Number.isFinite(query.offset) ? 0 : Math.max(0, Math.floor(query.offset));
  params.set("limit", String(clampPeopleLimit(query.limit)));
  params.set("offset", String(offset));
  return params;
}

export type ContactQueryKind = "empty" | "email" | "phone" | "name";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;

/**
 * Contact search accepts an email or a phone number only.
 * Anything else with text in it is a name, which the route rejects with 400.
 */
export function classifyContactQuery(value: string): ContactQueryKind {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if (EMAIL_RE.test(trimmed)) return "email";
  const digits = trimmed.replace(/\D/g, "");
  if (!/[a-z]/i.test(trimmed) && digits.length >= 7 && digits.length <= 15 && PHONE_RE.test(trimmed)) {
    return "phone";
  }
  return "name";
}

export function validateNewPerson(fields: { name: string; email: string; phone: string }): string | null {
  if (!fields.name.trim()) return "Enter a name.";
  const email = fields.email.trim();
  const phone = fields.phone.trim();
  if (!email && !phone) return "Enter an email address or a phone number.";
  if (email && classifyContactQuery(email) !== "email") return "That email address doesn’t look right.";
  if (phone && classifyContactQuery(phone) !== "phone") return "That phone number doesn’t look right.";
  return null;
}

/** Joined date for the table. Null becomes an em dash. */
export function formatJoined(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Inline tokens for the Missio skin. FFSA screens do not apply these. */
export function missioSkinVars(): Record<string, string> {
  return {
    "--side": "#1D2520",
    "--side-ink": "#F3EFE4",
    "--side-sub": "#AFB5A6",
    "--side-hover": "#28322C",
    "--side-rule": "#313B34",
    "--page": "#F3F0E8",
    "--panel": "#FBF9F4",
    "--subtle": "#EEEADF",
    "--rule": "#DDD7C8",
    "--ink": "#1C1B17",
    "--sub": "#5B574D",
    // #6E685B, not #7A7466: the lighter grey is 4.1:1 on --page and fails AA.
    "--quiet": "#6E685B",
    "--rule-strong": "#CFC8B6",
    "--link": "#2F5D50",
    "--accent": "#B4532E",
    // Terracotta as text. Plain --accent is 4.4:1 on --page, so text uses this.
    "--accent-text": "#8E3D1F",
    "--olive": "#4E6B4F",
    "--olive-soft": "#E3EADF",
    "--olive-text": "#3F5940",
    // Gold is for fills and edges only, never text. Text on gold-soft uses --gold-text.
    "--gold": "#B98A2E",
    "--gold-soft": "#F4EAD2",
    "--gold-text": "#7A5A17",
    "--radius-xs": "6px",
    "--radius-sm": "10px",
    "--radius-md": "14px",
    "--radius-lg": "20px",
    "--shadow-1": "0 1px 2px rgba(28, 27, 23, 0.05)",
    "--shadow-2": "0 6px 18px rgba(28, 27, 23, 0.1)",
    "--shadow-3": "0 -10px 40px rgba(28, 27, 23, 0.2)",
    "--accent-ink": "#FFF8EE",
    "--accent-soft": "#F6E4D9",
    "--ok": "#3F6E45",
    "--ok-soft": "#E1ECDD",
    "--warn": "#94631A",
    "--warn-soft": "#F5E8CF",
    "--bad": "#A3261B",
    "--bad-soft": "#F6DEDA",
  };
}
