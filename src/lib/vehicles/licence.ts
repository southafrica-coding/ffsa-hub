/**
 * Driver eligibility — one source of truth for "may this person drive?".
 *
 * Both the booking form and the API import this. The form uses it to disable
 * the submit button and explain why; the API uses it to actually refuse. The
 * client check is a courtesy, the server check is the rule — anyone can post
 * JSON straight at the endpoint.
 */

export type DriverLicenceInfo = {
  licence_expiry_date: string | null;
  licence_file_url: string | null;
  base_driving_test_status: "not_required" | "pending" | "passed" | "failed";
  /** They declared they hold no licence (209). Nothing else matters. */
  licence_kind?: string | null;
  /** Their licence carries no printed expiry — real in some countries (209). */
  licence_no_expiry?: boolean | null;
};

export type DriverBlockReason =
  | "no_licence"
  | "expired"
  | "expires_before_return"
  | "test_pending"
  | "test_failed";

export type DriverEligibility =
  | { ok: true }
  | { ok: false; reason: DriverBlockReason; message: string };

/**
 * When the check runs.
 *
 * "request" applies the LICENCE rules only. A first-time driver must be
 * addable to a request — the driving test is arranged off the back of a
 * booking, and the manager records the result from that booking's driver
 * list. Blocking them at request time would deadlock: no booking, so no
 * test, so no booking.
 *
 * "approval" adds the driving-test rule, which is where it always belonged
 * ("first-time drivers must pass a driving test before approval").
 */
export type EligibilityStage = "request" | "approval";

/**
 * Why a driver can't be added, or null if they're clear.
 *
 * `returnDate` is the booking's return date (YYYY-MM-DD). A licence that
 * expires mid-trip is treated exactly like one that has already expired —
 * the driver would be unlicensed on the road, which is the thing that
 * actually matters, not their status on the day of booking.
 */
export function checkDriverEligibility(
  driver: DriverLicenceInfo,
  returnDate: string | null,
  stage: EligibilityStage = "approval"
): DriverEligibility {
  // Someone who told the licence gate they don't hold a licence is never a
  // driver, whatever else is on the row.
  if (driver.licence_kind === "none") {
    return {
      ok: false,
      reason: "no_licence",
      message: "They've told us they don't hold a driver's licence.",
    };
  }

  // An expiry date is required UNLESS they declared their licence carries
  // none — otherwise those holders could never drive.
  const expiryKnown = !!driver.licence_expiry_date || !!driver.licence_no_expiry;
  if (!driver.licence_file_url || !expiryKnown) {
    return {
      ok: false,
      reason: "no_licence",
      message: "No driver's licence on file. Ask them to add one to their profile.",
    };
  }

  // A licence with no printed expiry can't expire, so both date checks below
  // are skipped rather than failing on a null.
  if (driver.licence_no_expiry || !driver.licence_expiry_date) {
    return stage === "request" ? { ok: true } : checkTest(driver);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (driver.licence_expiry_date < today) {
    return {
      ok: false,
      reason: "expired",
      message: `Licence expired on ${driver.licence_expiry_date}.`,
    };
  }
  if (returnDate && driver.licence_expiry_date < returnDate) {
    return {
      ok: false,
      reason: "expires_before_return",
      message: `Licence expires on ${driver.licence_expiry_date}, before the return date.`,
    };
  }

  // Licence rules are absolute; the driving test only gates approval.
  if (stage === "request") return { ok: true };
  return checkTest(driver);
}

/** The driving-test half of the rules — approval stage only. */
function checkTest(driver: DriverLicenceInfo): DriverEligibility {
  if (driver.base_driving_test_status === "failed") {
    return {
      ok: false,
      reason: "test_failed",
      message: "Did not pass the base-vehicle driving test.",
    };
  }
  if (driver.base_driving_test_status === "pending") {
    return {
      ok: false,
      reason: "test_pending",
      message: "Still needs to pass the base-vehicle driving test.",
    };
  }
  return { ok: true };
}

/** Short status chip text for a driver in the picker. */
export function licenceStatusLabel(
  driver: DriverLicenceInfo,
  returnDate: string | null
): { label: string; tone: "ok" | "warn" | "bad" } {
  const check = checkDriverEligibility(driver, returnDate, "approval");
  if (check.ok) {
    return {
      label: driver.licence_no_expiry
        ? "Licence on file (no expiry)"
        : `Licence valid to ${driver.licence_expiry_date}`,
      tone: "ok",
    };
  }
  // A pending driving test is shown as a warning, not an error: the request
  // goes through, and approval is what waits on the result.
  return {
    label: check.message,
    tone: check.reason === "test_pending" ? "warn" : "bad",
  };
}
