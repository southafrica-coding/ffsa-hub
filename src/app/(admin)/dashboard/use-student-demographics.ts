"use client";

import { useEffect, useState } from "react";

export type RankedCountry = { country: string; count: number; percent: number };

export type ProgramBreakdown = {
  id: string;
  name: string;
  code: string;
  total: number;
  tiers: { A: number; B: number; C: number; unknown: number };
  genders: Record<string, number>;
  nationalities: RankedCountry[];
};

export type ScopeData = {
  perProgram: ProgramBreakdown[];
  overall: {
    total: number;
    tiers: { A: number; B: number; C: number; unknown: number };
    genders: Record<string, number>;
    nationalities: RankedCountry[];
  };
};

export type Demographics = {
  programs: { id: string; name: string; code: string }[];
  // One deduped population: accepted applicants OR arrived enrollees, counted
  // once. See src/app/api/schools/student-demographics/route.ts.
  population: ScopeData | null;
};

export type DemographicsState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; data: Demographics };

// All three demographics widgets read one endpoint. Cache the in-flight
// promise at module scope so enabling all three costs a single request.
let cached: Promise<DemographicsState> | null = null;

function load(): Promise<DemographicsState> {
  if (cached) return cached;
  cached = (async (): Promise<DemographicsState> => {
    try {
      const res = await fetch("/api/schools/student-demographics", {
        cache: "no-store",
      });
      if (res.status === 403 || res.status === 401) return { status: "forbidden" };
      if (!res.ok) return { status: "error" };
      return { status: "ready", data: (await res.json()) as Demographics };
    } catch {
      return { status: "error" };
    }
  })();
  return cached;
}

export function useStudentDemographics(): DemographicsState {
  const [state, setState] = useState<DemographicsState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    load().then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

// Shared control styling for the scope / school pickers.
export const pickerStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--rule-strong)",
  borderRadius: 0,
  color: "var(--text-primary)",
  fontFamily: "var(--font-roboto), Roboto, sans-serif",
  fontSize: "14px",
  lineHeight: 1.4,
  padding: "8px 12px",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
};
