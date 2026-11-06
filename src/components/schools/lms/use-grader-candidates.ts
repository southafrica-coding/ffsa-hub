"use client";

import { useEffect, useState } from "react";
import { lmsCall, lmsMessage, parseGraderCandidates, type GraderCandidate } from "@/lib/schools/lms-api";

const EMPTY = "No one on this school can be picked yet.";

/** Program-scoped people from GET .../grader-candidates. A missing call yields nobody. */
export function useGraderCandidates(programId: string): {
  people: GraderCandidate[];
  note: string | null;
} {
  const [people, setPeople] = useState<GraderCandidate[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    lmsCall<unknown>(`/api/schools/programs/${programId}/grader-candidates`)
      .then((body) => {
        if (cancelled) return;
        const next = parseGraderCandidates(body);
        setPeople(next);
        setNote(next.length === 0 ? EMPTY : null);
      })
      .catch((error) => {
        if (cancelled) return;
        setPeople([]);
        setNote(lmsMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [programId]);

  return { people, note };
}
