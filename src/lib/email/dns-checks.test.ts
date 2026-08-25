import { describe, expect, it } from "vitest";
import {
  joinTxtChunks,
  parseSpf,
  parseDkim,
  parseDmarc,
  sendingBlockedReason,
} from "./dns-checks";

describe("joinTxtChunks", () => {
  it("joins without a separator — a space would corrupt a split key", () => {
    expect(joinTxtChunks(["v=DKIM1; p=AAAA", "BBBB"])).toBe("v=DKIM1; p=AAAABBBB");
  });
});

describe("parseSpf", () => {
  it("accepts exactly one SPF record", () => {
    expect(parseSpf([["v=spf1 include:_spf.resend.com ~all"]])).toBe(true);
  });

  it("ignores unrelated TXT records alongside it", () => {
    expect(
      parseSpf([["google-site-verification=abc"], ["v=spf1 -all"]])
    ).toBe(true);
  });

  it("rejects TWO SPF records — receivers ignore both, so it is broken", () => {
    expect(parseSpf([["v=spf1 include:a ~all"], ["v=spf1 include:b ~all"]])).toBe(
      false
    );
  });

  it("rejects a domain with no SPF at all", () => {
    expect(parseSpf([["something-else"]])).toBe(false);
    expect(parseSpf([])).toBe(false);
  });
});

describe("parseDkim", () => {
  it("accepts a record carrying a public key", () => {
    expect(parseDkim([["v=DKIM1; k=rsa; p=MIGfMA0GCSq"]])).toBe(true);
  });

  it("REJECTS an empty p= — that is a revoked key, not a present one", () => {
    expect(parseDkim([["v=DKIM1; k=rsa; p="]])).toBe(false);
    expect(parseDkim([["v=DKIM1; p=;"]])).toBe(false);
  });

  it("handles a key split across chunks", () => {
    expect(parseDkim([["v=DKIM1; k=rsa; p=AAAA", "BBBBCCCC"]])).toBe(true);
  });

  it("rejects nothing at the selector", () => {
    expect(parseDkim([])).toBe(false);
  });
});

describe("parseDmarc", () => {
  it("accepts a DMARC record", () => {
    expect(parseDmarc([["v=DMARC1; p=none"]])).toBe(true);
  });

  it("is case-insensitive about the version tag", () => {
    expect(parseDmarc([["V=dmarc1; p=quarantine"]])).toBe(true);
  });

  it("rejects an unrelated TXT record", () => {
    expect(parseDmarc([["v=spf1 -all"]])).toBe(false);
  });
});

describe("sendingBlockedReason", () => {
  it("does NOT block a domain that has never been checked", () => {
    // A check that has not run yet must never become an outage.
    expect(
      sendingBlockedReason({
        domain: "ffsahub.com",
        dkim_ok: null,
        last_checked_at: null,
      })
    ).toBeNull();
  });

  it("does not block when DKIM passed", () => {
    expect(
      sendingBlockedReason({
        domain: "ffsahub.com",
        dkim_ok: true,
        last_checked_at: "2026-08-25T00:00:00Z",
      })
    ).toBeNull();
  });

  it("blocks, and names the domain, once DKIM is known missing", () => {
    const reason = sendingBlockedReason({
      domain: "ffsahub.com",
      dkim_ok: false,
      last_checked_at: "2026-08-25T00:00:00Z",
    });
    expect(reason).toContain("ffsahub.com");
    expect(reason).toContain("DKIM");
  });

  it("does not block on a checked domain whose dkim_ok is still null", () => {
    // e.g. the row was created by the backfill and the check errored.
    expect(
      sendingBlockedReason({
        domain: "ffsahub.com",
        dkim_ok: null,
        last_checked_at: "2026-08-25T00:00:00Z",
      })
    ).toBeNull();
  });
});
