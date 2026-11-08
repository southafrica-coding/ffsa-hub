// Where a failed Wild Ones checkout attempt should move the buyer.
// The mobile CHECKOUT bar stays on screen while the inline PAY button
// sits below a long per-ticket block. Sending every failure to the top
// of the buyer section hides the field that actually failed.

export type WildOnesCheckoutFailure =
  | "buyer"
  | "checkout"
  | "tickets"
  | "waiver"
  | "consent";

export function revealTargetId(failure: WildOnesCheckoutFailure): string {
  if (failure === "tickets") return "wo-ticket-questions";
  if (failure === "waiver") return "wo-waiver";
  if (failure === "consent") return "wo-consent";
  return "wo-buyer";
}

// The waiver block is above the pay buttons. "Below" pointed people at
// the footer.
export const WAIVER_BLOCK_MESSAGE =
  "Please read and sign the required form for each ticket.";
