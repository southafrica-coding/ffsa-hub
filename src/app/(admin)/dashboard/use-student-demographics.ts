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
  students: ScopeData | null;
  applicants: ScopeData | null;
};

// Students and applicants are separate views, never summed — an enrolled
// student usually has an application row too.
export type Scope = "students" | "applicants";

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
  background: "hsl(22 8% 12%)",
  border: "1px solid hsl(22 8% 18%)",
  borderRadius: "6px",
  color: "hsl(30 8% 65%)",
  fontSize: "10px",
  padding: "4px 8px",
  letterSpacing: "0.05em",
};
