// What the public apply success page may say about the confirmation email.
// "skipped" is a school that turned the template off on purpose. That is
// not a failure, so the page stays quiet about email. "failed" is the only
// case that says the message did not go out.

export type ConfirmationStatus = "sent" | "skipped" | "failed";

export function confirmationSentence(status: ConfirmationStatus): string | null {
  if (status === "sent") return "We've sent a confirmation to your email.";
  if (status === "failed") return "We couldn't send a confirmation email.";
  return null;
}
