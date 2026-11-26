import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifySlackSignature } from "./verify";

const sign = (secret: string, ts: string, body: string) =>
  "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");

describe("verifySlackSignature per bot", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = "hub-secret";
    process.env.SLACK_OUTREACH_SIGNING_SECRET = "outreach-secret";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const ts = () => String(Math.floor(Date.now() / 1000));
  const body = '{"type":"event_callback"}';

  it("accepts each app's own signature", () => {
    const t = ts();
    expect(verifySlackSignature(body, t, sign("hub-secret", t, body))).toBe(true);
    expect(verifySlackSignature(body, t, sign("outreach-secret", t, body), "outreach")).toBe(true);
  });

  it("rejects a request signed by the other app", () => {
    const t = ts();
    expect(verifySlackSignature(body, t, sign("hub-secret", t, body), "outreach")).toBe(false);
    expect(verifySlackSignature(body, t, sign("outreach-secret", t, body))).toBe(false);
  });

  it("rejects everything for a bot whose secret isn't set yet", () => {
    delete process.env.SLACK_OUTREACH_SIGNING_SECRET;
    const t = ts();
    expect(verifySlackSignature(body, t, sign("", t, body), "outreach")).toBe(false);
  });
});

describe("verifySlackSignature for the Hub assistant app", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = "hub-secret";
    process.env.SLACK_ASSISTANT_SIGNING_SECRET = "assistant-secret";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const body = '{"type":"event_callback"}';

  it("uses the assistant secret, not the hub one", () => {
    const t = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(body, t, sign("assistant-secret", t, body), "assistant")).toBe(true);
    expect(verifySlackSignature(body, t, sign("hub-secret", t, body), "assistant")).toBe(false);
    expect(verifySlackSignature(body, t, sign("assistant-secret", t, body))).toBe(false);
  });
});
