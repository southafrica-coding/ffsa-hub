import { describe, expect, it } from "vitest";
import { confirmationSentence } from "./confirmation-notice";

describe("confirmationSentence", () => {
  it("says the email went out only when the send succeeded", () => {
    expect(confirmationSentence("sent")).toBe("We've sent a confirmation to your email.");
  });

  it("stays quiet when the school turned the template off", () => {
    expect(confirmationSentence("skipped")).toBeNull();
  });

  it("warns only when the send itself failed", () => {
    expect(confirmationSentence("failed")).toBe("We couldn't send a confirmation email.");
  });
});
