import { afterEach, describe, expect, it } from "vitest";
import { isMissingTableError, isUniqueViolation } from "@/services/account-deletion";
import {
  DEFAULT_DELETION_CONTACT_EMAIL,
  deletionContactEmail,
  deletionNotifyEmailsFromEnv,
} from "./config";
import { deletionRequestAdminEmail, deletionRequestConfirmationEmail } from "./emails";

afterEach(() => {
  delete process.env.ACCOUNT_DELETION_NOTIFY_EMAIL;
  delete process.env.ACCOUNT_DELETION_CONTACT_EMAIL;
});

describe("isMissingTableError", () => {
  it("spots Postgres and PostgREST 'no such table'", () => {
    expect(isMissingTableError({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(
      isMissingTableError({ message: 'relation "public.account_deletion_requests" does not exist' })
    ).toBe(true);
  });

  it("doesn't mistake other errors for it", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTableError({ message: 'relation "public.other" does not exist' })).toBe(false);
  });

  it("isUniqueViolation is 23505 only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("config", () => {
  it("notify list: empty unless set; trimmed, lower-cased, junk dropped", () => {
    expect(deletionNotifyEmailsFromEnv()).toEqual([]);
    process.env.ACCOUNT_DELETION_NOTIFY_EMAIL = " A@x.org ,nope, b@y.org";
    expect(deletionNotifyEmailsFromEnv()).toEqual(["a@x.org", "b@y.org"]);
  });

  it("contact address: env, else the published default", () => {
    expect(deletionContactEmail()).toBe(DEFAULT_DELETION_CONTACT_EMAIL);
    process.env.ACCOUNT_DELETION_CONTACT_EMAIL = "privacy@ffsa.test";
    expect(deletionContactEmail()).toBe("privacy@ffsa.test");
    process.env.ACCOUNT_DELETION_CONTACT_EMAIL = "not-an-address";
    expect(deletionContactEmail()).toBe(DEFAULT_DELETION_CONTACT_EMAIL);
  });
});

describe("emails", () => {
  it("escape what the person typed", () => {
    const { html } = deletionRequestAdminEmail({
      person: { userId: "u", name: "<b>Eve</b>", email: null },
      reason: "<script>x</script>",
      requestedAt: "2026-11-03T10:00:00Z",
      source: "app",
      recorded: true,
      siteUrl: "https://hub.test",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<b>Eve</b>");
    expect(html).toContain("https://hub.test/users/u");
  });

  it("confirmation names the date, the 30 days, the kept records and the contact", () => {
    const { subject, html } = deletionRequestConfirmationEmail({
      name: "Thandi",
      requestedAt: "2026-11-03T10:00:00Z",
      contactEmail: "office@ffsa.test",
      siteUrl: "https://hub.test",
    });
    expect(subject).toMatch(/received your request/);
    expect(html).toContain("3 November 2026");
    expect(html).toContain("within 30 days");
    expect(html).toContain("Receipts, payments and invoices");
    expect(html).toContain("office@ffsa.test");
    expect(html).toContain("https://hub.test/legal/delete-account");
  });
});
