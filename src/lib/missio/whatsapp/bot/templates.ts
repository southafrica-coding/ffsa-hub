// ────────────────────────────────────────────────────────────
// Missio WhatsApp — leader notices (Utility templates, defined only)
// ────────────────────────────────────────────────────────────
// Server only for notifyLeaderByTemplate; the definitions are pure.
//
// Jack, 23 Nov 2026: team and house leaders should hear about new people
// on WhatsApp through Utility templates. These are DEFINED here so they
// can be submitted to Meta once Jack OKs the wording. Nothing in the Hub
// creates or submits templates (no call to Meta's template-creation API),
// and nothing is sent to a leader until:
//   1. the template is APPROVED in Meta (read with the existing list
//      helper, listApprovedTemplates), AND
//   2. LEADER_NOTIFY_TEMPLATES_ENABLED is switched on in a later change
//      Jack OKs. It is hard off in this PR.
// Until then the Hub inbox is the notice: the serving interest is stored
// and the thread shows "Serve" to pastors. Leaders don't get inbox access.

import type { SendConfig } from "../config";
import { sendWhatsApp, type FetchLike } from "../graph";
import { templateComponents, type TemplateView } from "../rules";
import type { ThreadRow } from "../store";

/** Hard off in this PR. Turning it on is a separate change Jack OKs. */
export const LEADER_NOTIFY_TEMPLATES_ENABLED = false as boolean;

export type LeaderTemplateName = "serve_leader_interest" | "house_leader_new_person";

export type LeaderTemplateDefinition = {
  name: LeaderTemplateName;
  category: "UTILITY";
  language: "en";
  body: string;
  /** What each positional variable holds, in order ({{1}}, {{2}}, …). */
  variables: string[];
  /** Example values for Meta's review. Made up. */
  examples: string[];
  urlButtons: Array<{ text: string; url: string }>;
};

export const LEADER_TEMPLATES: Record<LeaderTemplateName, LeaderTemplateDefinition> = {
  serve_leader_interest: {
    name: "serve_leader_interest",
    category: "UTILITY",
    language: "en",
    body: "Hi {{1}}, {{2}} has asked to serve on {{3}} at Missio. You can follow up in the Hub.",
    variables: ["leader first name", "person first name (or Someone)", "team name"],
    examples: ["Thandi", "Sam", "Welcome"],
    urlButtons: [],
  },
  house_leader_new_person: {
    name: "house_leader_new_person",
    category: "UTILITY",
    language: "en",
    body: "Hi {{1}}, {{2}} would like to visit a house church ({{3}}). You can follow up in the Hub.",
    variables: ["leader first name", "person first name (or Someone)", "area"],
    examples: ["Thandi", "Sam", "Bult"],
    urlButtons: [],
  },
};

/** A template variable can't be empty, multi-line or long. "Someone" stands in for a missing name. */
export function templateValue(value: string | null | undefined, fallback: string): string {
  const flat = (value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return flat || fallback;
}

export type LeaderSendDecision = { send: true } | { send: false; reason: "disabled" | "not_approved" | "opted_out" | "no_phone" };

/** Pure: may this notice go to this leader on WhatsApp? */
export function leaderTemplateDecision(input: {
  enabled: boolean;
  approved: TemplateView | null;
  leaderPhone: string | null;
  leaderThread: Pick<ThreadRow, "opted_out_at"> | null;
}): LeaderSendDecision {
  if (!input.enabled) return { send: false, reason: "disabled" };
  if (!input.approved || input.approved.blockedReason) return { send: false, reason: "not_approved" };
  if (!input.leaderPhone) return { send: false, reason: "no_phone" };
  if (input.leaderThread?.opted_out_at) return { send: false, reason: "opted_out" };
  return { send: true };
}

export type Leader = { contactId: string; firstName: string | null; e164: string | null };

export type NotifyDeps = {
  config: SendConfig | null;
  loadTemplates: () => Promise<{ ok: true; templates: TemplateView[] } | { ok: false }>;
  /** Leaders of a missio_teams row (missio_team_leaders). */
  leadersFor: (teamId: string) => Promise<Leader[]>;
  findThread: (orgId: string, e164: string) => Promise<ThreadRow | null>;
  fetcher?: FetchLike;
};

export type NotifyResult = {
  /** Where the notice is: always the Hub inbox; WhatsApp only when sent. */
  channel: "hub_inbox" | "hub_inbox_and_whatsapp";
  sent: number;
  skipped: Array<LeaderSendDecision & { send: false }>;
};

/**
 * Tell a team's leaders about a new serving interest. The Hub-inbox notice
 * (the stored interest, visible to pastors) always stands; the WhatsApp
 * template only goes when leaderTemplateDecision allows it — never in this
 * PR, because the flag is off.
 */
export async function notifyLeaderByTemplate(
  deps: NotifyDeps,
  input: { orgId: string; template: "serve_leader_interest"; teamId: string | null; teamName: string; personFirstName: string | null }
): Promise<NotifyResult> {
  const hubOnly = (reason: LeaderSendDecision & { send: false }): NotifyResult => ({ channel: "hub_inbox", sent: 0, skipped: [reason] });
  if (!LEADER_NOTIFY_TEMPLATES_ENABLED) return hubOnly({ send: false, reason: "disabled" });
  if (!deps.config || !input.teamId) return hubOnly({ send: false, reason: "not_approved" });

  const definition = LEADER_TEMPLATES[input.template];
  const loaded = await deps.loadTemplates();
  const approved = loaded.ok ? (loaded.templates.find((t) => t.name === definition.name && t.language === definition.language) ?? null) : null;

  let sent = 0;
  const skipped: NotifyResult["skipped"] = [];
  for (const leader of await deps.leadersFor(input.teamId)) {
    const leaderThread = leader.e164 ? await deps.findThread(input.orgId, leader.e164) : null;
    const decision = leaderTemplateDecision({ enabled: LEADER_NOTIFY_TEMPLATES_ENABLED, approved, leaderPhone: leader.e164, leaderThread });
    if (!decision.send || !approved || !leader.e164) {
      if (!decision.send) skipped.push(decision);
      continue;
    }
    const values = {
      "body:1": templateValue(leader.firstName, "there"),
      "body:2": templateValue(input.personFirstName, "Someone"),
      "body:3": templateValue(input.teamName, "a team"),
    };
    const result = await sendWhatsApp(
      deps.config,
      { kind: "template", to: leader.e164, name: approved.name, language: approved.language, components: templateComponents(approved, values) },
      deps.fetcher
    );
    if (result.ok) sent += 1;
  }
  return { channel: sent > 0 ? "hub_inbox_and_whatsapp" : "hub_inbox", sent, skipped };
}
