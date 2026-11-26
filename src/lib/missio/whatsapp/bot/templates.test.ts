import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateView } from "../rules";
import { LEADER_NOTIFY_TEMPLATES_ENABLED, LEADER_TEMPLATES, leaderTemplateDecision, notifyLeaderByTemplate, templateValue } from "./templates";

// Fakes only. No Meta, no real numbers.
const CONFIG = { accessToken: "test-token-not-real", phoneNumberId: "100000000000001", wabaId: "300000000000003" };

const approvedServe: TemplateView = {
  name: "serve_leader_interest",
  language: "en",
  category: "utility",
  header: null,
  body: LEADER_TEMPLATES.serve_leader_interest.body,
  footer: null,
  variables: [1, 2, 3].map((n) => ({ part: "body" as const, key: String(n) })),
  blockedReason: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("leader templates (defined in code, never created in Meta)", () => {
  it("describes serve_leader_interest and house_leader_new_person as English Utility templates", () => {
    expect(LEADER_TEMPLATES.serve_leader_interest).toMatchObject({
      category: "UTILITY",
      language: "en",
      body: "Hi {{1}}, {{2}} has asked to serve on {{3}} at Missio. You can follow up in the Hub.",
    });
    expect(LEADER_TEMPLATES.house_leader_new_person).toMatchObject({
      category: "UTILITY",
      language: "en",
      body: "Hi {{1}}, {{2}} would like to visit a house church ({{3}}). You can follow up in the Hub.",
    });
    for (const t of Object.values(LEADER_TEMPLATES)) {
      expect(t.variables).toHaveLength(3);
      expect(t.examples).toHaveLength(3);
      expect(t.body.match(/\{\{\d\}\}/g)).toEqual(["{{1}}", "{{2}}", "{{3}}"]);
    }
  });

  it("the send flag is hard off in this PR", () => {
    expect(LEADER_NOTIFY_TEMPLATES_ENABLED).toBe(false);
  });

  it("nothing in the Hub calls Meta's template-creation API", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");
    const files = [...readdirSync(root).map((f) => path.join(root, f)), ...readdirSync(__dirname).map((f) => path.join(__dirname, f))].filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")
    );
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Reading approved templates is a GET on message_templates; creating one would POST to it.
      expect(text, file).not.toMatch(/message_templates[^\n]*method:\s*"POST"|method:\s*"POST"[^\n]*message_templates/);
    }
  });
});

describe("leaderTemplateDecision", () => {
  const base = { enabled: true, approved: approvedServe, leaderPhone: "+27820000009", leaderThread: null };
  it("flag off → no send, even when approved", () => {
    expect(leaderTemplateDecision({ ...base, enabled: false })).toEqual({ send: false, reason: "disabled" });
  });
  it("missing approval → no send", () => {
    expect(leaderTemplateDecision({ ...base, approved: null })).toEqual({ send: false, reason: "not_approved" });
    expect(leaderTemplateDecision({ ...base, approved: { ...approvedServe, blockedReason: "media" } })).toEqual({ send: false, reason: "not_approved" });
  });
  it("opted-out leader → no send", () => {
    expect(leaderTemplateDecision({ ...base, leaderThread: { opted_out_at: "2026-11-01T00:00:00Z" } })).toEqual({ send: false, reason: "opted_out" });
  });
  it("no phone → no send", () => {
    expect(leaderTemplateDecision({ ...base, leaderPhone: null })).toEqual({ send: false, reason: "no_phone" });
  });
  it("only all four together would send (a later, OK'd change)", () => {
    expect(leaderTemplateDecision(base)).toEqual({ send: true });
  });
});

describe("notifyLeaderByTemplate", () => {
  it("with the flag off: Hub inbox only, no Graph call of any kind, even with an approved template and a leader", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const loadTemplates = vi.fn(async () => ({ ok: true as const, templates: [approvedServe] }));
    const leadersFor = vi.fn(async () => [{ contactId: "c9", firstName: "Thandi", e164: "+27820000009" }]);
    const result = await notifyLeaderByTemplate(
      { config: CONFIG, loadTemplates, leadersFor, findThread: async () => null, fetcher },
      { orgId: "org-missio", template: "serve_leader_interest", teamId: "team-1", teamName: "Kids", personFirstName: "Sam" }
    );
    expect(result).toEqual({ channel: "hub_inbox", sent: 0, skipped: [{ send: false, reason: "disabled" }] });
    expect(fetcher).not.toHaveBeenCalled();
    expect(loadTemplates).not.toHaveBeenCalled();
    expect(leadersFor).not.toHaveBeenCalled();
  });

  it("template values are single-line, short, with a stand-in for a missing name", () => {
    expect(templateValue(null, "Someone")).toBe("Someone");
    expect(templateValue("  Sam \n Example ", "Someone")).toBe("Sam Example");
    expect(templateValue("x".repeat(100), "Someone")).toHaveLength(60);
  });
});
