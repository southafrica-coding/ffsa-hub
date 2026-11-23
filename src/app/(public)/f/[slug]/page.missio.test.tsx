import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// /f/missio-weekly-feedback: opens with no login (access_mode still
// "token" on the row) and hands off to the Missio public form with its
// house picker. Any other token form still says "personal link".

const h = vi.hoisted(() => ({ form: null as Record<string, unknown> | null, sessionAsked: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    h.sessionAsked += 1;
    return { auth: { getUser: async () => ({ data: { user: null } }) } };
  },
}));
vi.mock("@/services/forms", () => ({ getFormBySlug: async () => ({ data: h.form, error: null }) }));
vi.mock("./missio-weekly", () => ({ MissioPublicWeeklyFeedback: function MissioPublicWeeklyFeedback() { return null; } }));
vi.mock("./form-runtime", () => ({ FormRuntime: function FormRuntime() { return null; } }));
vi.mock("@/components/public-form-shell", () => ({ PublicFormNotice: function PublicFormNotice() { return null; } }));

import PublicFormPage, { generateMetadata } from "./page";

const missioForm = {
  id: "form-1",
  slug: "missio-weekly-feedback",
  kind: "missio_weekly_feedback",
  access_mode: "token",
  name: "Missio weekly feedback",
  is_active: true,
  event_id: null,
  events: null,
  schema: { version: 1, steps: [] },
};

const open = async (slug: string) => (await PublicFormPage({ params: Promise.resolve({ slug }) })) as ReactElement<Record<string, unknown>>;
const typeName = (el: ReactElement) => (el.type as { name?: string }).name;

beforeEach(() => {
  h.form = { ...missioForm };
  h.sessionAsked = 0;
});

describe("/f/missio-weekly-feedback", () => {
  it("renders the Missio public form with no login and never asks for a session", async () => {
    const el = await open("missio-weekly-feedback");
    expect(typeName(el)).toBe("MissioPublicWeeklyFeedback");
    expect(el.props.schema).toEqual(missioForm.schema);
    expect(h.sessionAsked).toBe(0);
  });

  it("is not indexed and says nothing about a house", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "missio-weekly-feedback" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(meta)).toContain("Weekly feedback");
  });

  it("another token form still fails closed", async () => {
    h.form = { ...missioForm, slug: "other-token-form", kind: "general" };
    const el = await open("other-token-form");
    expect(typeName(el)).toBe("PublicFormNotice");
    expect(String(el.props.body)).toContain("personal link");
  });

  it("an inactive weekly form shows the not-available notice", async () => {
    h.form = { ...missioForm, is_active: false };
    const el = await open("missio-weekly-feedback");
    expect(typeName(el)).toBe("PublicFormNotice");
  });
});
