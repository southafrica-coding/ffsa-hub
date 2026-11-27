// Migration 424 vs Hub UI #745: the leads shapes the Songwriting pages
// declare locally must match the db.types rows the API returns.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  LEAD_KINDS,
  LEAD_STATUSES,
  type SongwritingLead,
  type SongwritingLeadEvent,
} from "@/components/departments/songwriting/types";
import {
  PW_LEAD_KINDS,
  PW_LEAD_STATUSES,
  type PwNation,
  type PwSongwritingLead,
  type PwSongwritingLeadEvent,
  type PwSongwritingTraining,
} from "./db.types";

/** Flattens an intersection so toEqualTypeOf compares plain object types. */
type Flat<T> = { [K in keyof T]: T[K] };

describe("424 songwriting contract", () => {
  it("lead kinds and statuses match the UI", () => {
    expect([...PW_LEAD_KINDS]).toEqual([...LEAD_KINDS]);
    expect([...PW_LEAD_STATUSES]).toEqual([...LEAD_STATUSES]);
  });

  // The UI reads created_by / by for edit gating (never writes them), so
  // its shapes are the API's answers: the row plus owner_name / by_name.
  it("a lead row plus owner_name is the UI SongwritingLead", () => {
    expectTypeOf<Flat<PwSongwritingLead & { owner_name: string | null }>>().toEqualTypeOf<Flat<SongwritingLead>>();
  });

  it("a lead event row plus by_name is the UI SongwritingLeadEvent", () => {
    expectTypeOf<Flat<PwSongwritingLeadEvent & { by_name: string | null }>>().toEqualTypeOf<Flat<SongwritingLeadEvent>>();
  });

  it("nations and trainings carry the 424 columns", () => {
    expectTypeOf<PwNation["iso_code"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PwNation["languages"]>().toEqualTypeOf<string[]>();
    expectTypeOf<PwSongwritingTraining["training_date"]>().toEqualTypeOf<string | null>();
  });
});
