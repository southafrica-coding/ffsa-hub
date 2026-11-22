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
 * MissioSA Brand Guide v1.0 (2026) named colours. Everything else in the skin
 * is one of these, or an alpha tint of ink or cream (the Guide's rule for
 * hairlines and secondary text). Never a grey, pure white or pure black.
 */
export const MISSIO_BRAND = {
  ink: "#17372F",
  deepInk: "#0D2923",
  paper: "#F2EFE6",
  cream: "#FFFAF0",
  lime: "#D9F45A",
  sun: "#F18F3B",
  sage: "#A8BAA6",
  muted: "#60746E",
  /** Derived, not a named Guide colour: lifted ink for fields and panels on the dark ground. */
  liftedInk: "#1C3E36",
} as const;

const B = MISSIO_BRAND;
const inkA = (alpha: number) => `rgb(23 55 47 / ${alpha})`;
const creamA = (alpha: number) => `rgb(255 250 240 / ${alpha})`;
const sunA = (alpha: number) => `rgb(241 143 59 / ${alpha})`;
const sageA = (alpha: number) => `rgb(168 186 166 / ${alpha})`;
const limeA = (alpha: number) => `rgb(217 244 90 / ${alpha})`;

/** Shared by both grounds: the Guide has no rounded corners and no shadows. */
const SHAPE = {
  "--radius-xs": "0",
  "--radius-sm": "0",
  "--radius-md": "0",
  "--radius-lg": "0",
  "--shadow-1": "none",
  "--shadow-2": "none",
  "--shadow-3": "none",
} as const;

/** Paper ground: ink type, sun SA. The default. */
const LIGHT: Record<string, string> = {
  // The rail is ink on both grounds, so its SA is lime and its active item is a lime strip.
  "--side": B.ink,
  "--side-ink": B.cream,
  "--side-sub": creamA(0.72),
  "--side-hover": B.liftedInk,
  "--side-rule": creamA(0.18),
  "--side-on": B.lime,
  "--side-on-ink": B.ink,
  "--page": B.paper,
  "--panel": B.cream,
  "--subtle": inkA(0.05),
  "--rule": inkA(0.22),
  "--ink": B.ink,
  "--sub": inkA(0.78),
  // Ink at 72%, not Muted #60746E: Muted is 4.3:1 on paper and fails AA for small text.
  "--quiet": inkA(0.72),
  "--muted": B.muted,
  "--rule-strong": inkA(0.4),
  "--link": B.ink,
  // Primary action on paper is an ink block with cream type.
  "--accent": B.ink,
  "--accent-text": B.ink,
  "--accent-ink": B.cream,
  "--accent-soft": B.lime,
  "--sa": B.sun,
  "--em": B.sun,
  "--olive": B.ink,
  "--olive-soft": B.sage,
  "--olive-text": B.ink,
  // Sun is for fills, edges and marks. Sun text fails on paper, so text on sun tints is ink.
  "--gold": B.sun,
  "--gold-soft": sunA(0.22),
  "--gold-text": B.ink,
  "--ok": B.ink,
  "--ok-soft": B.sage,
  "--warn": B.sun,
  "--warn-soft": sunA(0.22),
  "--warn-text": B.ink,
  "--bad": B.sun,
  "--bad-soft": sunA(0.22),
  "--bad-text": B.ink,
  "--field": B.cream,
  ...SHAPE,
};

/** Ink ground: cream type, lime SA. */
const DARK: Record<string, string> = {
  "--side": B.ink,
  "--side-ink": B.cream,
  "--side-sub": creamA(0.72),
  "--side-hover": B.liftedInk,
  "--side-rule": creamA(0.18),
  "--side-on": B.lime,
  "--side-on-ink": B.ink,
  "--page": B.ink,
  "--panel": B.liftedInk,
  "--subtle": creamA(0.05),
  "--rule": creamA(0.22),
  "--ink": B.cream,
  "--sub": creamA(0.78),
  "--quiet": B.sage,
  "--muted": B.sage,
  "--rule-strong": creamA(0.4),
  "--link": B.cream,
  // Primary action on ink is a lime block with ink type.
  "--accent": B.lime,
  "--accent-text": B.lime,
  "--accent-ink": B.ink,
  "--accent-soft": limeA(0.14),
  "--sa": B.lime,
  "--em": B.sun,
  "--olive": B.sage,
  "--olive-soft": sageA(0.2),
  "--olive-text": B.cream,
  "--gold": B.sun,
  "--gold-soft": sunA(0.2),
  "--gold-text": B.cream,
  "--ok": B.lime,
  "--ok-soft": sageA(0.2),
  "--warn": B.sun,
  "--warn-soft": sunA(0.2),
  "--warn-text": B.cream,
  "--bad": B.sun,
  "--bad-soft": sunA(0.2),
  "--bad-text": B.cream,
  "--field": B.liftedInk,
  ...SHAPE,
};

export type MissioTheme = "light" | "dark";

/**
 * Tokens for the Missio skin, from the MissioSA Brand Guide. FFSA screens do
 * not apply these. Surfaces set the paper (light) values inline; the ink (dark)
 * values are applied over them by missio-theme.css, from `prefers-color-scheme`
 * or an explicit `data-missio-theme` on <html>. Never the Hub's dark tokens.
 */
export function missioSkinVars(theme: MissioTheme = "light"): Record<string, string> {
  return { ...(theme === "dark" ? DARK : LIGHT) };
}
