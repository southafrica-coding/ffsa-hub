import { REFINE_BONUS_Q_NO } from "./types";

/** Refine questions 1–10, from Cooper's songwriting handbook. Wording is exact. */
export const REFINE_QUESTIONS: readonly string[] = [
  "Is the song cohesive? Does it flow naturally?",
  "Is the tense of the language appropriate for this song? Are your pronouns consistent and accurate?",
  "Are there any specific parts that make you hesitate or feel confused?",
  "Is the main idea communicated clearly throughout the song?",
  "Can people from different backgrounds listen to this song and understand what is being communicated?",
  "What is one thing you really like about this song?",
  "What is one thing you really don’t like about this song?",
  "Is there anything you are holding on to too tightly that actually needs to change?",
  "Would it be helpful to get feedback from someone outside the writing process for a fresh perspective?",
  "Is there anything else specific that God is saying about this song?",
];

/** q 11. A bonus, not a gate: it never blocks a stage move. */
export const REFINE_BONUS_QUESTION = "Are you satisfied and happy with the song?";

export function refineProgress(items: readonly { q_no: number; checked: boolean }[]): { done: number; bonus: boolean } {
  let done = 0;
  let bonus = false;
  for (const item of items) {
    if (!item.checked) continue;
    if (item.q_no === REFINE_BONUS_Q_NO) bonus = true;
    else if (item.q_no >= 1 && item.q_no <= 10) done += 1;
  }
  return { done, bonus };
}
