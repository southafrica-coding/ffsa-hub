// #756 follow-ups: training_date, nation codes and languages, payloads that
// never carry 424's columns, and edit gating from the API's viewer block.
// No database: every record here is an in-memory fake.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";
import { errorCopy, fieldCopy } from "@/components/song-library/client";
import { SW_CODES } from "@/lib/songwriting/types";
import { normaliseData, songwritingApi } from "./api";
import { leadToDraft, leadToInput } from "./lead-draft";
import { nationToDraft, nationToInput } from "./nation-draft";
import { languagesForNation, nationCode, summariseNations } from "./nations";
import { contactPayload, leadPayload, nationPayload, READ_ONLY_KEYS, trainingPayload } from "./payloads";
import { applyDeletedContact, applyLoggedContact } from "./followup";
import { canEdit, editBandCopy } from "./permissions";
import { checkTrainingDate, toDraft, toInput, type TrainingDraft } from "./training-draft";
import type { SongwritingLead, SongwritingViewerOut } from "./types";

const STAMP = "2026-11-26T08:00:00.000Z";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NATION_ID = "33333333-3333-4333-8333-333333333333";
const TRAINING_ID = "44444444-4444-4444-8444-444444444444";
const LEAD_ID = "55555555-5555-4555-8555-555555555555";

function nation(extra: Partial<PwNation> = {}): PwNation {
  return {
    id: NATION_ID,
    name: "Atlantis",
    slug: "atlantis",
    continent: "africa",
    status: "active",
    notes: null,
    iso_code: null,
    languages: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

function training(extra: Partial<PwSongwritingTraining> = {}): PwSongwritingTraining {
  return {
    id: TRAINING_ID,
    year: 2026,
    month: 3,
    training_date: "2026-03-14",
    location_text: "Harbour Town",
    nation_id: NATION_ID,
    audience_label: "Test group",
    people_trained: 12,
    songs_workshop: 3,
    songs_post: null,
    notes: null,
    languages: ["Zed"],
    status: "completed",
    source: "hub",
    import_key: null,
    created_by: OTHER,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

function lead(extra: Partial<SongwritingLead> = {}): SongwritingLead {
  return {
    id: LEAD_ID,
    label: "Test worship team",
    kind: "group",
    contact_user_id: null,
    source_training_id: TRAINING_ID,
    nation_id: NATION_ID,
    note: "Follow up after Easter",
    owner_user_id: ME,
    owner_name: "Test Person",
    status: "to_contact",
    last_contact_at: "2026-10-01T09:00:00.000Z",
    created_by: OTHER,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

function keysDeep(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [k, ...keysDeep(v)]);
}

function expectNoReadOnly(body: unknown) {
  const keys = keysDeep(body);
  for (const key of READ_ONLY_KEYS) expect(keys).not.toContain(key);
  expect(keys).not.toContain("owner_name");
}

// ── 1) training_date ────────────────────────────────────────

describe("training form: training_date", () => {
  const base = (): TrainingDraft => toDraft(training(), []);

  it("prefills the date from training_date, date only", () => {
    expect(base().training_date).toBe("2026-03-14");
    expect(toDraft(training({ training_date: "2026-03-14T00:00:00+00:00" }), []).training_date).toBe("2026-03-14");
    expect(toDraft(training({ training_date: null }), []).training_date).toBe("");
  });

  it("sends a date inside the month", () => {
    const r = toInput(base());
    expect("input" in r && r.input.training_date).toBe("2026-03-14");
  });

  it("flags a date outside the month on training_date", () => {
    const r = toInput({ ...base(), training_date: "2026-04-02" });
    expect(r).toEqual({ fields: ["training_date"] });
    expect(checkTrainingDate("2026-04-02", 2026, 3)).toBe("outside_month");
    expect(checkTrainingDate("2026-02-30", 2026, 2)).toBe("invalid");
  });

  it("sends null for a blank date (month only)", () => {
    const r = toInput({ ...base(), training_date: "" });
    expect("input" in r && r.input.training_date).toBeNull();
    expect("input" in r && "training_date" in r.input).toBe(true);
  });

  it("always sends training_date when the month changes", () => {
    // Moved to April, date cleared: null, so the API never keeps March's day.
    const cleared = toInput({ ...base(), month: "2026-04", training_date: "" });
    expect("input" in cleared && cleared.input).toMatchObject({ year: 2026, month: 4, training_date: null });
    expect(trainingPayload((cleared as { input: never }).input)).toHaveProperty("training_date", null);
    // Moved to April with a new April date.
    const moved = toInput({ ...base(), month: "2026-04", training_date: "2026-04-09" });
    expect("input" in moved && moved.input).toMatchObject({ month: 4, training_date: "2026-04-09" });
    // Moved to April but the March date left behind: caught before sending.
    expect(toInput({ ...base(), month: "2026-04" })).toEqual({ fields: ["training_date"] });
  });

  it("maps the server's fieldErrors.training_date to fixed copy", () => {
    expect(fieldCopy("training_date")).toBe("Pick a date in the training's month, or leave it blank.");
  });
});

// ── 2) errorCopy / fieldCopy ────────────────────────────────

describe("errorCopy for #756 codes", () => {
  it("has fixed copy for every new code, never the default", () => {
    const fallback = errorCopy("something_unknown");
    for (const code of [
      SW_CODES.trainingDateOutsideMonth,
      SW_CODES.nationHasLeads,
      SW_CODES.nationHasTrainings,
      SW_CODES.nationInUse,
      SW_CODES.readOnlyField,
    ]) {
      expect(errorCopy(code)).not.toBe(fallback);
    }
    expect(errorCopy("nation_has_leads")).toBe("This nation still has leads. Move or delete them first.");
    expect(errorCopy("nation_has_trainings")).toBe("This nation still has trainings. Move or delete them first.");
  });

  it("still covers the shared vocabulary", () => {
    for (const code of ["forbidden", "unauthenticated", "not_found", "invalid_input", "check_failed", "duplicate"]) {
      expect(errorCopy(code)).not.toBe(errorCopy(null));
    }
  });

  it("uses the default for unknown codes, never server text", () => {
    const serverText = "training_date must fall in the training's year and month";
    expect(errorCopy(serverText)).toBe("That didn't save. Please try again.");
    expect(errorCopy(undefined)).toBe("That didn't save. Please try again.");
  });

  it("has field copy for the fields the forms surface", () => {
    const fallback = fieldCopy("no_such_field");
    for (const f of ["training_date", "iso_code", "slug", "languages", "label", "name", "contact_user_id", "kind", "status", "note", "notes"]) {
      expect(fieldCopy(f)).not.toBe(fallback);
    }
    // A duplicate code or slug reads differently from a bad format.
    expect(fieldCopy("iso_code", "duplicate")).toBe("Another nation already has that code.");
    expect(fieldCopy("slug", "duplicate")).toBe("Another nation already uses that slug.");
  });
});

// ── 3) never send created_by, by, last_contact_at ───────────

describe("payloads never carry 424's columns", () => {
  it("training create/update", () => {
    const r = toInput(toDraft(training(), []));
    if (!("input" in r)) throw new Error("expected input");
    expectNoReadOnly(trainingPayload(r.input));
    // Even when a record with them is passed straight in.
    expectNoReadOnly(trainingPayload({ ...r.input, ...({ created_by: ME, source: "hub", import_key: "x" } as object) } as typeof r.input));
  });

  it("nation create/update", () => {
    const r = nationToInput(nationToDraft(nation({ iso_code: "AT" })), "edit");
    if (!("input" in r)) throw new Error("expected input");
    expectNoReadOnly(nationPayload(r.input));
    expect(Object.keys(nationPayload({ ...r.input, ...({ created_by: ME, id: NATION_ID } as object) }))).not.toContain("id");
  });

  it("lead create/update, from a lead that has created_by and last_contact_at", () => {
    const r = leadToInput(leadToDraft(lead()));
    if (!("input" in r)) throw new Error("expected input");
    expectNoReadOnly(leadPayload(r.input));
    expectNoReadOnly(leadPayload(lead() as never));
  });

  it("log contact sends { note } (and at) only", () => {
    expect(contactPayload({ note: "Called" })).toEqual({ note: "Called" });
    expectNoReadOnly(contactPayload({ note: "Called", ...({ by: ME, last_contact_at: STAMP } as object) } as { note: string }));
  });

  describe("on the wire", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("every write the client makes leaves them out", async () => {
      const bodies: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.body) bodies.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
        })
      );
      const api = songwritingApi("prayer_and_worship");
      const t = toInput(toDraft(training(), []));
      if (!("input" in t)) throw new Error("expected input");
      const leaky = { created_by: ME, by: ME, last_contact_at: STAMP, owner_name: "x" };
      await api.createTraining({ ...t.input, ...leaky } as never);
      await api.updateTraining(TRAINING_ID, { ...t.input, ...leaky } as never);
      await api.createNation({ ...nation(), ...leaky } as never);
      await api.updateNation(NATION_ID, { ...nation(), ...leaky } as never);
      await api.createLead(lead() as never);
      await api.updateLead(LEAD_ID, lead() as never);
      await api.logContact(LEAD_ID, { note: "Called", ...leaky } as never);
      await api.logContact(LEAD_ID, "Called");
      expect(bodies).toHaveLength(8);
      for (const body of bodies) expectNoReadOnly(body);
    });
  });
});

// ── 4) nations: iso_code and languages ──────────────────────

describe("nations: iso_code and languages", () => {
  it("uses iso_code when set", () => {
    expect(nationCode(nation({ iso_code: "MG" }))).toBe("MG");
    expect(nationCode(nation({ iso_code: "mg" }))).toBe("MG");
  });

  it("falls back to the name when iso_code is null", () => {
    expect(nationCode(nation())).toBe("AT");
    expect(nationCode(nation({ name: "Côte d'Ivoire", iso_code: null }))).toBe("CT");
  });

  it("prefers the nation's stored languages", () => {
    const n = nation({ languages: ["Malagasy", "French"] });
    expect(languagesForNation(n, [training({ languages: ["Zed"] })])).toEqual(["Malagasy", "French"]);
    expect(summariseNations([n], [training()])[0].languages).toEqual(["Malagasy", "French"]);
  });

  it("falls back to the trainings' union when none are stored", () => {
    const ts = [training({ id: "a", languages: ["Zed", "alpha"] }), training({ id: "b", languages: ["zed", "Beta"] }), training({ id: "c", nation_id: "other", languages: ["Gamma"] })];
    expect(languagesForNation(nation({ languages: [] }), ts)).toEqual(["alpha", "Beta", "Zed"]);
    expect(languagesForNation({ id: NATION_ID, languages: null }, ts)).toEqual(["alpha", "Beta", "Zed"]);
    expect(summariseNations([nation()], ts)[0].languages).toEqual(["alpha", "Beta", "Zed"]);
  });

  it("validates the nation form before sending", () => {
    expect(nationToInput({ ...nationToDraft(null), name: "New Land" }, "create")).toEqual({
      input: { name: "New Land", continent: null, status: "active", notes: null, iso_code: null, languages: [] },
    });
    expect(nationToInput({ ...nationToDraft(null), name: "X", iso_code: "ZAF" }, "create")).toEqual({ fields: ["iso_code"] });
    expect(nationToInput({ ...nationToDraft(nation()), slug: "Not A Slug" }, "edit")).toEqual({ fields: ["slug"] });
    const tentative = nationToInput({ ...nationToDraft(null), name: "Maybe", status: "tentative", iso_code: "za", languages: [" Zulu ", ""] }, "create");
    expect(tentative).toEqual({ input: expect.objectContaining({ status: "tentative", iso_code: "ZA", languages: ["Zulu"] }) });
  });
});

// ── 5) edit / delete visibility from the viewer block ───────

describe("edit and delete follow viewer.edit_rule", () => {
  const viewer = (extra: Partial<SongwritingViewerOut> = {}): SongwritingViewerOut => ({
    user_id: ME,
    is_admin: false,
    is_leader: false,
    edit_rule: "rls",
    ...extra,
  });

  it("hides everything until the viewer arrives", () => {
    expect(canEdit(null, { kind: "nation" })).toBe(false);
    expect(canEdit(undefined, { kind: "training", created_by: ME })).toBe(false);
    expect(normaliseData({}).viewer).toBeNull();
  });

  it("rls: any member edits nations, trainings and leads", () => {
    const v = viewer();
    expect(canEdit(v, { kind: "nation" })).toBe(true);
    expect(canEdit(v, { kind: "training", created_by: OTHER })).toBe(true);
    expect(canEdit(v, { kind: "lead", created_by: OTHER })).toBe(true);
    expect(editBandCopy(v, "Prayer & Worship")).toBe("Anyone in Prayer & Worship can add and edit.");
  });

  it("creator_leaders_admins: the creator, leaders and admins only", () => {
    const member = viewer({ edit_rule: "creator_leaders_admins" });
    expect(canEdit(member, { kind: "training", created_by: ME })).toBe(true);
    expect(canEdit(member, { kind: "training", created_by: OTHER })).toBe(false);
    expect(canEdit(member, { kind: "lead", created_by: OTHER })).toBe(false);
    expect(canEdit(member, { kind: "lead", created_by: null })).toBe(false);
    expect(canEdit(member, { kind: "nation" })).toBe(false);
    for (const v of [viewer({ edit_rule: "creator_leaders_admins", is_leader: true }), viewer({ edit_rule: "creator_leaders_admins", is_admin: true })]) {
      expect(canEdit(v, { kind: "nation" })).toBe(true);
      expect(canEdit(v, { kind: "lead", created_by: OTHER })).toBe(true);
    }
    expect(editBandCopy(member, "Prayer & Worship")).not.toContain("can add and edit");
  });

  it("logged contacts: the author or an admin, under either rule", () => {
    for (const edit_rule of ["rls", "creator_leaders_admins"] as const) {
      expect(canEdit(viewer({ edit_rule }), { kind: "lead_event", by: ME })).toBe(true);
      expect(canEdit(viewer({ edit_rule }), { kind: "lead_event", by: OTHER })).toBe(false);
      expect(canEdit(viewer({ edit_rule, is_leader: true }), { kind: "lead_event", by: OTHER })).toBe(false);
      expect(canEdit(viewer({ edit_rule, is_admin: true }), { kind: "lead_event", by: OTHER })).toBe(true);
    }
  });

  it("validates the lead form before sending", () => {
    expect(leadToInput({ ...leadToDraft(null), label: "  " })).toEqual({ fields: ["label"] });
    expect(leadToInput({ ...leadToDraft(null), label: "A", contact_user_id: "not-an-id" })).toEqual({ fields: ["contact_user_id"] });
    expect(leadToInput({ ...leadToDraft(null), label: "A" })).toEqual({
      input: { label: "A", kind: "person", status: "new", contact_user_id: null, source_training_id: null, nation_id: null, note: null, owner_user_id: null },
    });
  });
});

describe("apply contact replies", () => {
  const eventA = { id: "ev-a", lead_id: LEAD_ID, at: "2026-11-01T10:00:00.000Z", by: ME, by_name: "Ada", note: "First", created_at: STAMP, updated_at: STAMP };
  const eventB = { id: "ev-b", lead_id: LEAD_ID, at: "2026-11-26T10:00:00.000Z", by: ME, by_name: "Ada", note: "Called", created_at: STAMP, updated_at: STAMP };

  it("updates the lead and prepends the new event from { lead, event }", () => {
    const lead = { id: LEAD_ID, last_contact_at: eventB.at } as SongwritingLead;
    const next = applyLoggedContact([eventA], { lead, event: eventB });
    expect(next.lead).toBe(lead);
    expect(next.events.map((e) => e.id)).toEqual(["ev-b", "ev-a"]);
  });

  it("replaces an event with the same id rather than duplicating it", () => {
    const lead = { id: LEAD_ID } as SongwritingLead;
    const next = applyLoggedContact([eventB], { lead, event: { ...eventB, note: "Updated" } });
    expect(next.events).toHaveLength(1);
    expect(next.events[0]?.note).toBe("Updated");
  });

  it("updates the lead and drops the deleted event from { lead, deleted }", () => {
    const lead = { id: LEAD_ID, last_contact_at: eventA.at } as SongwritingLead;
    const next = applyDeletedContact([eventB, eventA], { lead, deleted: "ev-b" });
    expect(next.lead).toBe(lead);
    expect(next.events.map((e) => e.id)).toEqual(["ev-a"]);
  });
});
