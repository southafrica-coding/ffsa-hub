"use client";

import { useEffect, useState } from "react";

export type ProgramAnalytics = {
  id: string;
  name: string;
  code: string;
  applications: number;
  accepted: number;
  enrolled: number;
  arrived: number;
  inFlight: number;
  acceptanceRate: number | null;
  arrivalRate: number | null;
  // Null for "view"-level grants — the per-status breakdown is management detail.
  byStatus: Record<string, number> | null;
};

export type SchoolsAnalytics = {
  programs: ProgramAnalytics[];
  totals: {
    applications: number;
    accepted: number;
    enrolled: number;
    arrived: number;
    inFlight: number;
    acceptanceRate: number | null;
    arrivalRate: number | null;
  } | null;
  canSeeAll: boolean;
};

export type AnalyticsState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; data: SchoolsAnalytics };

// Both schools widgets read the same endpoint. Cache the in-flight promise at
// module scope so having both enabled costs one request, not two — and so
// toggling widgets on and off doesn't re-fetch what we already have.
let cached: Promise<AnalyticsState> | null = null;

function load(): Promise<AnalyticsState> {
  if (cached) return cached;
  cached = (async (): Promise<AnalyticsState> => {
    try {
      const res = await fetch("/api/schools/dashboard-analytics", {
        cache: "no-store",
      });
      if (res.status === 403 || res.status === 401) return { status: "forbidden" };
      if (!res.ok) return { status: "error" };
      return { status: "ready", data: (await res.json()) as SchoolsAnalytics };
    } catch {
      return { status: "error" };
    }
  })();
  return cached;
}

export function useSchoolsAnalytics(): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({ status: "loading" });

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
