import { describe, it, expect } from "vitest";
import { domainState, fullHost, normalizeDomain } from "./sending-domain-rules";

describe("normalizeDomain", () => {
  it("takes the domain out of what people paste", () => {
    expect(normalizeDomain("ffglobal.org")).toEqual({ domain: "ffglobal.org" });
    expect(normalizeDomain("  FFGlobal.ORG ")).toEqual({ domain: "ffglobal.org" });
    expect(normalizeDomain("info@ffglobal.org")).toEqual({ domain: "ffglobal.org" });
    expect(normalizeDomain("https://www.ffglobal.org/about")).toEqual({ domain: "ffglobal.org" });
    expect(normalizeDomain("events.ffsouthafrica.co.za")).toEqual({ domain: "events.ffsouthafrica.co.za" });
  });

  it("refuses things that aren't domains", () => {
    expect("error" in normalizeDomain("")).toBe(true);
    expect("error" in normalizeDomain("ffglobal")).toBe(true);
    expect("error" in normalizeDomain("ff global.org")).toBe(true);
    expect("error" in normalizeDomain("-bad.org")).toBe(true);
    expect("error" in normalizeDomain("bad.o")).toBe(true);
  });
});

describe("domainState", () => {
  it("reads Resend statuses as plain words", () => {
    expect(domainState("verified")).toEqual({ label: "Verified — can send", tone: "good" });
    expect(domainState("not_started").tone).toBe("warn");
    expect(domainState("failed").tone).toBe("bad");
    expect(domainState(null).label).toBe("Not added to Resend");
  });
});

describe("fullHost", () => {
  it("adds the domain to a relative record name, once", () => {
    expect(fullHost("resend._domainkey", "ffglobal.org")).toBe("resend._domainkey.ffglobal.org");
    expect(fullHost("send.ffglobal.org", "ffglobal.org")).toBe("send.ffglobal.org");
    expect(fullHost("@", "ffglobal.org")).toBe("ffglobal.org");
  });
});
