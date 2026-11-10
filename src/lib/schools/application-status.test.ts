import { describe, expect, it } from "vitest";
import {
  BULK_STATUS_LIMIT,
  acceptedRegressNeedsConfirm,
  isBeforeAcceptance,
  storedStatusError,
} from "./application-status";

describe("application status changes", () => {
  it("rejects a value the database enum does not store", () => {
    expect(storedStatusError("interview_complete")).toBeTruthy();
    expect(storedStatusError("nope")).toBeTruthy();
    expect(storedStatusError("submitted")).toBeNull();
    expect(storedStatusError("waiting_for_references")).toBeNull();
  });

  it("blocks moving an accepted applicant back to an earlier stage unless confirm is set", () => {
    expect(isBeforeAcceptance("submitted")).toBe(true);
    expect(isBeforeAcceptance("references_received")).toBe(true);
    expect(isBeforeAcceptance("rejected")).toBe(false);
    expect(acceptedRegressNeedsConfirm("accepted", "submitted", false)).toBe(true);
    expect(acceptedRegressNeedsConfirm("accepted", "interview_scheduled", false)).toBe(true);
    expect(acceptedRegressNeedsConfirm("accepted", "submitted", true)).toBe(false);
    expect(acceptedRegressNeedsConfirm("accepted", "rejected", false)).toBe(false);
    expect(acceptedRegressNeedsConfirm("submitted", "references_received", false)).toBe(false);
  });

  it("caps a bulk update", () => {
    expect(BULK_STATUS_LIMIT).toBe(100);
  });
});
