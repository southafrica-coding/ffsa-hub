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
 * Why a driver can't be added, or null if they're clear.
 *
 * `returnDate` is the booking's return date (YYYY-MM-DD). A licence that
 * expires mid-trip is treated exactly like one that has already expired —
 * the driver would be unlicensed on the road, which is the thing that
 * actually matters, not their status on the day of booking.
 */
export function checkDriverEligibility(
  driver: DriverLicenceInfo,
  returnDate: string | null
): DriverEligibility {
  if (!driver.licence_file_url || !driver.licence_expiry_date) {
    return {
      ok: false,
      reason: "no_licence",
      message: "No driver's licence on file. Ask them to add one to their profile.",
    };
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
  const check = checkDriverEligibility(driver, returnDate);
  if (check.ok) {
    return {
      label: `Licence valid to ${driver.licence_expiry_date}`,
      tone: "ok",
    };
  }
  return {
    label: check.message,
    tone: check.reason === "test_pending" ? "warn" : "bad",
  };
}
