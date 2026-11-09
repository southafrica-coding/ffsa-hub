export const INTERVIEW_OUTCOMES = ["pending", "recommend", "hold", "decline"] as const;
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

export const INTERVIEW_OUTCOME_LABEL: Record<InterviewOutcome, string> = {
  pending: "No decision yet",
  recommend: "Recommend",
  hold: "Hold",
  decline: "Do not recommend",
};

export function isInterviewOutcome(value: unknown): value is InterviewOutcome {
  return typeof value === "string" && (INTERVIEW_OUTCOMES as readonly string[]).includes(value);
}
