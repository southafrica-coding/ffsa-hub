import { capRetryAfterSeconds } from "./api";

/**
 * Fixed copy for Missio error codes. The server's message is never shown.
 * `fieldErrors` on the public connect form are the only server strings the UI may render.
 */
export function missioFixedCopy(code: string | null | undefined, retryAfterSeconds?: number | null): string {
  switch (code) {
    case "invalid_input":
      return "Check the details and try again.";
    case "not_missio_person":
      return "This person isn’t in Missio yet.";
    case "not_found":
      return "We couldn’t find that.";
    case "already_member":
      return "Already in this house.";
    case "already_resolved":
      return "Someone else already updated this.";
    case "membership_not_current":
      return "That membership isn’t current.";
    case "ended_at_in_future":
      return "That end date is still in the future.";
    case "exists_use_search":
      return "This person is already in FFSA’s contacts. Search for them and link them.";
    case "unauthenticated":
      return "Sign in to continue.";
    case "forbidden":
      return "Pastors only.";
    case "rate_limited": {
      const seconds = capRetryAfterSeconds(retryAfterSeconds);
      const unit = seconds === 1 ? "second" : "seconds";
      return `Please wait ${seconds} ${unit}, then try again.`;
    }
    case "server_error":
      return "That didn’t go through. Please try again.";
    default:
      return "That didn’t work. Please try again.";
  }
}

/** Codes that mean another pastor already changed the row. Refetch after showing the copy. */
export function isStaleWrite(code: string | null | undefined): boolean {
  return code === "already_resolved";
}
