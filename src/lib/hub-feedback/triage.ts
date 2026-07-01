/**
 * Classify a finished report into type / area / size / danger-zone and
 * a *proposed* lane. Phase 1 only displays the proposed lane in the
 * triage brief — nothing acts on it yet (Lanes A/B are Phases 2–3).
 */

import { completeJson } from "./ai";
import type { Classification, CollectedInfo } from "./types";

const SYSTEM = `You are the triage brain for the FFSA Hub, an internal staff web app (Next.js).
You classify a single staff-reported issue. Respond with a JSON object ONLY.

Fields:
- type: "bug" (something is broken/wrong) | "idea" (a new feature or tweak that doesn't exist yet) | "question" (a how-to that needs no change).
- area: the Hub section it concerns, Title Case, e.g. "Dashboard", "Profile", "Bookings", "Prayer Room", "Org Chart", "Finance", "Training", "Events", "Contacts", "Communications", "Users & Roles". Best guess; null if truly unclear.
- size: for bugs only, else null. "cosmetic" (copy/label/styling/layout/config constant — no logic), "small_logic" (a small, localized logic/display fix, ~1 file), "big" (multi-file, unclear, or needs real design).
- danger_zone: true if a fix would touch ANY of: database migrations/schema, auth or account recovery, permissions/RLS, payments (PayFast/Xero) or money, data deletion/destructive changes, or more than a couple of files. Otherwise false.
- proposed_lane: "auto_ship" (cosmetic or small_logic bug, danger_zone false), "build_on_approval" (bug that is big or danger_zone true), "product_decision" (any idea, or a question).
- title: a short imperative summary (max ~8 words).
- summary: one or two plain sentences describing the problem/request.
- reason: one short sentence explaining the size/lane call.

Rules:
- Ideas are ALWAYS proposed_lane "product_decision".
- If danger_zone is true, proposed_lane must be "build_on_approval" (never auto_ship), regardless of size.
- Be conservative: when unsure whether something is small, size it up ("big") and route to build_on_approval.`;

export async function classify(
  collected: CollectedInfo,
  reportText: string
): Promise<Classification> {
  const user = `Report:
"""
${reportText}
"""
Structured understanding so far: ${JSON.stringify(collected)}

Classify it.`;

  const raw = await completeJson<Partial<Classification>>({ system: SYSTEM, user });

  // Defensive normalisation — never trust the model's shape blindly.
  const type: Classification["type"] =
    raw?.type === "idea" || raw?.type === "question" ? raw.type : "bug";
  const size =
    type === "bug" &&
    (raw?.size === "cosmetic" || raw?.size === "small_logic" || raw?.size === "big")
      ? raw.size
      : type === "bug"
        ? "big"
        : null;
  const danger = raw?.danger_zone === true;

  let lane: Classification["proposed_lane"];
  if (type !== "bug") lane = "product_decision";
  else if (danger || size === "big") lane = "build_on_approval";
  else lane = "auto_ship";

  return {
    type,
    area: typeof raw?.area === "string" && raw.area.trim() ? raw.area.trim() : null,
    size,
    danger_zone: danger,
    proposed_lane: lane,
    title: (raw?.title || collected.title || "Untitled report").slice(0, 120),
    summary: raw?.summary || collected.summary || reportText.slice(0, 300),
    reason: raw?.reason || "",
  };
}
