/**
 * Semantic dedup: decide whether a new report describes the same
 * underlying issue as one already open, so we track it once and never
 * fix it twice. Candidates are pre-filtered by area in the store; this
 * makes the final same/different call with Claude.
 */

import { completeJson } from "./ai";
import type { Classification, HubIssue } from "./types";

const SYSTEM = `You match a NEW staff-reported Hub issue against a list of EXISTING open issues.
Decide if the new report describes the SAME underlying problem/request as one of them —
even if worded very differently. Two reports match if fixing one would resolve the other.

Respond with JSON ONLY: { "match_id": "<existing id or null>", "confidence": 0.0-1.0, "reason": "<short>" }.
Only return a match_id when you are clearly confident (confidence >= 0.7). A related-but-distinct
issue (e.g. a different bug in the same area) is NOT a match.`;

export async function findDuplicate(
  classification: Classification,
  reportText: string,
  candidates: HubIssue[]
): Promise<HubIssue | null> {
  if (candidates.length === 0) return null;

  const list = candidates
    .map(
      (c) =>
        `- id: ${c.id}\n  title: ${c.title}\n  area: ${c.area ?? "?"}\n  summary: ${c.summary}`
    )
    .join("\n");

  const user = `NEW report:
title: ${classification.title}
area: ${classification.area ?? "?"}
summary: ${classification.summary}
detail: ${reportText}

EXISTING open issues:
${list}`;

  const res = await completeJson<{
    match_id: string | null;
    confidence: number;
    reason: string;
  }>({ system: SYSTEM, user });

  if (!res || !res.match_id) return null;
  if (typeof res.confidence === "number" && res.confidence < 0.7) return null;
  return candidates.find((c) => c.id === res.match_id) ?? null;
}
