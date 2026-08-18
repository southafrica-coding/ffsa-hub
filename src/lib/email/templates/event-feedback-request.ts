import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

/**
 * Asks someone who worked an event for their read on how it went.
 *
 * Deliberately short: this lands after a long weekend of serving, and a
 * wall of text is the fastest way to a 12% response rate. Name the event,
 * say how long it takes, give the link.
 */
export function eventFeedbackRequestEmailHtml({
  firstName,
  eventTitle,
  feedbackUrl,
  isReminder,
  isAnonymous,
  note,
  siteUrl,
}: {
  firstName?: string | null;
  eventTitle: string;
  feedbackUrl: string;
  isReminder?: boolean;
  isAnonymous?: boolean;
  note?: string | null;
  siteUrl?: string | null;
}): string {
  const greeting = firstName?.trim() ? `Hi ${escapeHtml(firstName.trim())},` : "Hi there,";

  const opening = isReminder
    ? bodyParagraph(
        `A quick nudge — we haven't heard from you yet about ${emphasis(escapeHtml(eventTitle))}, and your read on it genuinely shapes how we run the next one.`
      )
    : bodyParagraph(
        `Thank you for the way you served at ${emphasis(escapeHtml(eventTitle))}. Before it fades, we'd love your honest feedback on how it went.`
      );

  const privacyLine = isAnonymous
    ? bodyParagraph(
        "Your answers are <strong>anonymous</strong> — we can see that a response came in, but not who wrote it. Say the hard thing."
      )
    : bodyParagraph(
        "It takes about three minutes, and there are no wrong answers — the useful ones are the honest ones."
      );

  return renderEmailShell({
    title: isReminder ? "A quick reminder" : "How did it go?",
    preheader: `Your feedback on ${eventTitle} — about three minutes.`,
    eyebrow: isReminder ? "Still open" : "Post-event feedback",
    heading: isReminder ? "One more ask" : "How did<br/>it go?",
    bodyHtml: `
      ${bodyParagraph(greeting)}
      ${opening}
      ${privacyLine}
      ${note?.trim() ? bodyParagraph(escapeHtml(note.trim())) : ""}
      <p style="margin:24px 0 4px;font-size:12px;color:#5a4e44;line-height:1.6;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:0;font-size:11px;color:#7a6e64;word-break:break-all;line-height:1.6;">
        <a href="${escapeHtml(feedbackUrl)}" style="color:#F5C518;text-decoration:none;">${escapeHtml(feedbackUrl)}</a>
      </p>
    `,
    cta: { label: "Give your feedback", url: feedbackUrl },
    siteUrl,
  });
}
