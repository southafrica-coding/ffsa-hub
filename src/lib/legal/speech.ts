// Turning the helper's written answers into something that sounds right
// when read aloud, and recognising spoken commands. Pure, so it's tested.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Most characters read aloud in one go; the rest stays on screen. */
export const MAX_SPOKEN_CHARS = 700;

export function plainForSpeech(markdown: string, max = MAX_SPOKEN_CHARS): string {
  let s = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/legal-documents\S*/g, "")
    // uuids mean nothing out loud
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    // 2026-11-18 → 18 November 2026
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => {
      const month = MONTHS[Number(mo) - 1];
      return month ? `${Number(d)} ${month} ${y}` : m;
    })
    .replace(/→/g, ", then ")
    .replace(/R ?(\d[\d,]*)(\.\d\d)?/g, "$1 rand")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?:;,])(?:\s*\.)+/g, "$1")
    .trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    s = `${(end > max / 2 ? cut.slice(0, end + 1) : cut).trim()} The rest is on the screen.`;
  }
  return s;
}

export type SpokenCommand = "stop" | "background" | null;

/**
 * Hands-free mode listens for a few plain phrases.
 *   "stop listening" / "that's all" / "goodbye" → stop
 *   anything ending in "in the background" → hand it to a background task
 */
export function spokenCommand(text: string): SpokenCommand {
  const t = text.toLowerCase().replace(/[.,!?]/g, "").trim();
  if (/^(stop( listening)?|that'?s all( thanks| thank you)?|goodbye|bye|thank you that'?s all)$/.test(t)) return "stop";
  if (/\bin the background$/.test(t)) return "background";
  return null;
}
