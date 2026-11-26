import {
  CONFLICT_CHALLENGE,
  FRUIT_MAX,
  LOW_LEADER_SCORES,
  NO_HELP_NEEDED,
} from "@/lib/forms/templates/missio-weekly-feedback";

// ============================================================
// Sunday results (Hub Forms F4) — pure roll-up
// ============================================================
// Pastors and coaches see one week: totals for the houses that have
// sent, the houses still missing, what needs a coach, highlights and
// the house list. Totals never count a missing house as zero.
//
// Reads typed missio_house_feedback rows (390 columns). Prayer is not
// here: it lives on the Care board.
// ============================================================

export type ResultsHouse = { id: string; number: number; name: string | null };

export type FeedbackRow = {
  house_church_id: string;
  meeting_date: string;
  attendance?: number | null;
  first_time_count?: number | null;
  guest_count?: number | null;
  invited_count?: number | null;
  saved_count?: number | null;
  healing_count?: number | null;
  connected_score?: number | null;
  welcome_score?: number | null;
  leader_score?: number | null;
  win_type?: string | null;
  win_notes?: string | null;
  challenge_type?: string | null;
  testimonies?: string | null;
  activities?: string[] | null;
  training_needs?: string[] | null;
};

export type Kpi = { key: string; label: string; value: string };

export type CoachFlag = { kind: "score" | "conflict" | "training" | "saved"; who: string; title: string; body: string };

export type Highlight = { houseNumber: number; kind: "win" | "testimony"; lead: string; text: string };

export type HouseLine = {
  id: string;
  number: number;
  name: string | null;
  state: "sent" | "missing" | "flagged";
  summary: string;
};

export type SundayResults = {
  /** YYYY-MM-DD: the Sunday that ends the week. */
  sunday: string;
  total: number;
  sentCount: number;
  missing: number[];
  kpis: Kpi[];
  flags: CoachFlag[];
  highlights: Highlight[];
  houses: HouseLine[];
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "3", "3, 7 and 9". */
export function andList(items: Array<string | number>): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join("");
  return `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;
}

/** The week a Sunday closes: Monday to Sunday. */
export function weekOf(sunday: string): { from: string; to: string } {
  const d = new Date(`${sunday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return { from: d.toISOString().slice(0, 10), to: sunday };
}

const FRUIT_KEYS: ReadonlySet<keyof FeedbackRow> = new Set(["saved_count", "healing_count"]);

/** A total; for the 0–6 counts, `capped` says one of them was "more than 5". */
function sum(rows: FeedbackRow[], key: keyof FeedbackRow): { total: number; any: boolean; capped: boolean } {
  let total = 0;
  let any = false;
  let capped = false;
  for (const r of rows) {
    const n = num(r[key]);
    if (n == null) continue;
    any = true;
    total += n;
    if (FRUIT_KEYS.has(key) && n >= FRUIT_MAX) capped = true;
  }
  return { total, any, capped };
}

function avg(rows: FeedbackRow[], key: keyof FeedbackRow): string {
  const ns = rows.map((r) => num(r[key])).filter((n): n is number => n != null);
  if (ns.length === 0) return "—";
  return (ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1);
}

function kpi(key: string, label: string, s: { total: number; any: boolean; capped: boolean }): Kpi {
  // 6 means "more than 5", so a total that includes one is a floor.
  return { key, label, value: s.any ? `${s.total}${s.capped ? "+" : ""}` : "—" };
}

function trainingAsks(r: FeedbackRow): string[] {
  return (r.training_needs ?? []).filter((t) => t && t !== NO_HELP_NEEDED);
}

function lowScore(r: FeedbackRow): boolean {
  const n = num(r.leader_score);
  return n != null && (LOW_LEADER_SCORES as readonly number[]).includes(n);
}

const isConflict = (r: FeedbackRow) => r.challenge_type === CONFLICT_CHALLENGE;

function houseSummary(r: FeedbackRow): string {
  const bits: string[] = [];
  if (num(r.attendance) != null) bits.push(`${r.attendance} came`);
  if (lowScore(r)) bits.push(`leader score ${r.leader_score}`);
  if (isConflict(r)) bits.push("challenge: conflict");
  const saved = num(r.saved_count);
  if (saved) bits.push(`${saved >= FRUIT_MAX ? "5+" : saved} saved`);
  const first = num(r.first_time_count);
  if (first) bits.push(`${first} first time`);
  if (bits.length < 3 && trainingAsks(r).length > 0) bits.push(`wants ${trainingAsks(r)[0].toLowerCase()} help`);
  if (bits.length < 3 && num(r.connected_score) != null) bits.push(`connected ${r.connected_score}`);
  return bits.slice(0, 3).join(" · ") || "Sent";
}

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

/**
 * One week's roll-up. `rows` may hold any rows; only those in the week
 * that ends on `sunday` and for a listed house count. If a house sent
 * twice in the week (two meeting dates), the later one counts.
 */
export function buildSundayResults(
  houses: ResultsHouse[],
  rows: FeedbackRow[],
  sunday: string,
  opts: { slackOn?: boolean } = {}
): SundayResults {
  const { from, to } = weekOf(sunday);
  const byHouse = new Map<string, FeedbackRow>();
  for (const r of rows) {
    const d = String(r.meeting_date).slice(0, 10);
    if (d < from || d > to) continue;
    const prev = byHouse.get(r.house_church_id);
    if (!prev || String(prev.meeting_date) < d) byHouse.set(r.house_church_id, r);
  }
  const ordered = [...houses].sort((a, b) => a.number - b.number);
  const sent = ordered.filter((h) => byHouse.has(h.id));
  const sentRows = sent.map((h) => byHouse.get(h.id) as FeedbackRow);
  const missing = ordered.filter((h) => !byHouse.has(h.id)).map((h) => h.number);

  const kpis: Kpi[] = [
    kpi("attendance", "Attended", sum(sentRows, "attendance")),
    kpi("first_time", "First time", sum(sentRows, "first_time_count")),
    kpi("saved", "Saved", sum(sentRows, "saved_count")),
    kpi("invited", "Invited", sum(sentRows, "invited_count")),
    kpi("guests", "Guests", sum(sentRows, "guest_count")),
    kpi("healed", "Healed", sum(sentRows, "healing_count")),
    { key: "connected", label: "Connected", value: avg(sentRows, "connected_score") },
    { key: "welcome", label: "Welcome", value: avg(sentRows, "welcome_score") },
  ];

  const told = (who: string) => (opts.slackOn ? ` ${who} by private Slack message.` : "");
  const flags: CoachFlag[] = [];
  for (const h of sent) {
    const r = byHouse.get(h.id) as FeedbackRow;
    if (lowScore(r)) {
      flags.push({
        kind: "score",
        who: `Score ${r.leader_score}`,
        title: `House ${h.number} · leader wellbeing`,
        body: `The leader scored ${r.leader_score} of 5. Their coach should check in this week.${told("Coach told")}`,
      });
    }
  }
  for (const h of sent) {
    const r = byHouse.get(h.id) as FeedbackRow;
    if (isConflict(r)) {
      flags.push({
        kind: "conflict",
        who: "Conflict",
        title: `House ${h.number} · challenge`,
        body: `Challenge type: conflict or tension in the group.${told("Coach told")}`,
      });
    }
  }
  const training = sent.filter((h) => trainingAsks(byHouse.get(h.id) as FeedbackRow).length > 0);
  if (training.length > 0) {
    const counts = new Map<string, number>();
    for (const h of training) for (const t of trainingAsks(byHouse.get(h.id) as FeedbackRow)) counts.set(t, (counts.get(t) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const asks = andList(top.map(([t, n]) => `${t.toLowerCase()} (${n})`));
    flags.push({
      kind: "training",
      who: "Training",
      title: `${training.length === 1 ? "House" : "Houses"} ${andList(training.map((h) => h.number))}`,
      body: `Asked for help with ${asks}.`,
    });
  }
  const saved = sent.filter((h) => (num((byHouse.get(h.id) as FeedbackRow).saved_count) ?? 0) > 0);
  if (saved.length > 0) {
    const s = sum(saved.map((h) => byHouse.get(h.id) as FeedbackRow), "saved_count");
    const people = `${s.total}${s.capped ? "+" : ""}`;
    flags.push({
      kind: "saved",
      who: "Saved",
      title: `${saved.length === 1 ? "House" : "Houses"} ${andList(saved.map((h) => h.number))}`,
      body: `${people} ${s.total === 1 && !s.capped ? "person" : "people"} got saved.${told("Pastors told")}`,
    });
  }

  const highlights: Highlight[] = [];
  for (const h of sent) {
    const r = byHouse.get(h.id) as FeedbackRow;
    if (r.win_notes?.trim()) {
      highlights.push({
        houseNumber: h.number,
        kind: "win",
        lead: `House ${h.number} win.`,
        text: sentence(r.win_type && r.win_type !== "Other" ? `${r.win_type}: ${r.win_notes}` : r.win_notes),
      });
    }
  }
  for (const h of sent) {
    const r = byHouse.get(h.id) as FeedbackRow;
    if (r.testimonies?.trim()) {
      highlights.push({ houseNumber: h.number, kind: "testimony", lead: `House ${h.number} testimony.`, text: sentence(r.testimonies) });
    }
  }

  const houseLines: HouseLine[] = ordered.map((h) => {
    const r = byHouse.get(h.id);
    if (!r) return { id: h.id, number: h.number, name: h.name, state: "missing", summary: "Nothing yet" };
    return {
      id: h.id,
      number: h.number,
      name: h.name,
      state: lowScore(r) || isConflict(r) ? "flagged" : "sent",
      summary: houseSummary(r),
    };
  });

  return {
    sunday,
    total: ordered.length,
    sentCount: sent.length,
    missing,
    kpis,
    flags,
    highlights,
    houses: houseLines,
  };
}
