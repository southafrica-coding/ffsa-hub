import type { FeedbackThisWeek, MissingHouse } from "@/lib/missio/feedback-this-week";

export type { FeedbackThisWeek, MissingHouse };

/** Missio Home's weekly feedback card. Null: this viewer gets no missing list (403). */
export type FeedbackThisWeekClient = { thisWeek(): Promise<FeedbackThisWeek | null> };

const API = "/api/missio/feedback/this-week";

function house(raw: unknown): MissingHouse | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row || typeof row.id !== "string" || typeof row.number !== "number") return null;
  return { id: row.id, number: row.number, name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null };
}

export function createFeedbackThisWeekClient(fetchImpl: typeof fetch = fetch): FeedbackThisWeekClient {
  return {
    async thisWeek() {
      const res = await fetchImpl(API, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (res.status === 403) return null;
      if (!res.ok) throw new Error(`this-week ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!Array.isArray(body.missing)) throw new Error("unexpected shape");
      return {
        sunday: String(body.sunday ?? ""),
        total: Number(body.total ?? 0),
        sentCount: Number(body.sentCount ?? 0),
        missing: body.missing.map(house).filter((h): h is MissingHouse => h != null),
      };
    },
  };
}

export const feedbackThisWeekClient = createFeedbackThisWeekClient();
