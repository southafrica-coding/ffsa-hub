import { holdsMissioHouseRole } from "@/lib/missio/house-roles";
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
  /** Serves (on a team), doesn't serve, or has a new serving interest. */
  serves?: "yes" | "no" | "interested" | "";
  /** A missio_teams id: on that team as member or leader. */
  team?: string;
}

const TEAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
/** Pastors, coaches and house church leaders can open Missio. */
export function canAccessMissio(me: MissioMe): boolean {
  if (me.currentOrg !== "missio") return false;
  const roles: readonly string[] = me.rolesByOrg.missio ?? [];
  return roles.includes("pastor") || roles.includes("coach") || roles.includes("house_church_leader");
}

/**
 * Care in the nav and tab bar. Same role list as GET /api/missio/care
 * (MISSIO_HOUSE_ROLES), not canAccessMissio, so widening who opens Missio
 * never shows Care to someone the API refuses.
 */
export function canSeeMissioCare(me: MissioMe): boolean {
  if (me.currentOrg !== "missio") return false;
  return holdsMissioHouseRole(me.rolesByOrg.missio ?? []);
}

/** Pastors see everything: people, follow-up, volunteers, review, placing. */
export function isMissioPastor(me: MissioMe): boolean {
  if (me.currentOrg !== "missio") return false;
  const roles: readonly string[] = me.rolesByOrg.missio ?? [];
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
  if (query.serves === "yes" || query.serves === "no" || query.serves === "interested") params.set("serves", query.serves);
  const team = query.team?.trim();
  if (team && TEAM_ID.test(team)) params.set("team", team);
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

/**
 * The Missio design tokens (build guide §2, board M1a), name for name and value
 * for value. missio-tokens.css declares the same block under [data-org="missio"];
 * missio-theme.test.ts keeps the two identical. FFSA screens never apply these.
 *
 * Terracotta as text is always --terra-ink (plain --terra is 4.4:1 on paper).
 * Gold is never text. --ink-3 replaced the old #7A7466, which failed AA.
 */
export const MISSIO_TOKENS = {
  "--frame": "#1D2520",
  "--frame-ink": "#F3EFE4",
  "--frame-ink-2": "#A8B0A6",
  "--terra-on-frame": "#D7774F",
  "--page": "#F3F0E8",
  "--panel": "#FBF9F4",
  "--subtle": "#EEEADF",
  "--rule": "#DDD7C8",
  "--rule-strong": "#CFC8B6",
  "--ink": "#1C1B17",
  "--ink-2": "#5B574D",
  "--ink-3": "#6E685B",
  "--link": "#2F5D50",
  "--terra": "#B4532E",
  "--terra-soft": "#F6E4D9",
  "--terra-ink": "#8E3D1F",
  "--olive": "#4E6B4F",
  "--olive-soft": "#E3EADF",
  "--olive-ink": "#3F5940",
  "--gold": "#B98A2E",
  "--gold-soft": "#F4EAD2",
  "--gold-ink": "#7A5A17",
  "--ok": "#3F6E45",
  "--warn": "#94631A",
  "--bad": "#A3261B",
  "--radius-xs": "6px",
  "--radius-sm": "10px",
  "--radius-md": "14px",
  "--radius-lg": "20px",
  "--shadow-1": "0 1px 2px rgba(28,27,23,.05)",
  "--shadow-2": "0 6px 18px rgba(28,27,23,.10)",
  "--shadow-3": "0 -10px 40px rgba(28,27,23,.20)",
} as const;

const T = MISSIO_TOKENS;

/**
 * Names the Missio CSS modules already use, each pointing at a guide token's
 * value. New CSS should use the guide names above.
 */
const ALIASES: Record<string, string> = {
  "--side": T["--frame"],
  "--side-ink": T["--frame-ink"],
  "--side-sub": T["--frame-ink-2"],
  "--side-on": T["--terra-on-frame"],
  // Frame tints for hover and hairlines: the frame lifted, not a new colour.
  "--side-hover": "#28322C",
  "--side-rule": "#313B34",
  "--sub": T["--ink-2"],
  "--quiet": T["--ink-3"],
  "--muted": T["--ink-3"],
  "--accent": T["--terra"],
  "--accent-text": T["--terra-ink"],
  "--accent-soft": T["--terra-soft"],
  // Type on a terracotta button.
  "--accent-ink": "#FFF8EE",
  "--olive-text": T["--olive-ink"],
  "--gold-text": T["--gold-ink"],
  "--ok-soft": T["--olive-soft"],
  "--warn-soft": T["--gold-soft"],
  "--bad-soft": "#F6DEDA",
};

/** Inline tokens for a Missio surface: the guide tokens plus the older aliases. */
export function missioSkinVars(): Record<string, string> {
  return { ...MISSIO_TOKENS, ...ALIASES };
}
