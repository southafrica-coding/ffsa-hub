import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hubSlackAssistantEnabled, hubSlackAssistantLive, hubSlackAssistantModelReady } from "./flags";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("hubSlackAssistantEnabled", () => {
  it("is off by default", () => {
    expect(hubSlackAssistantEnabled(env({}))).toBe(false);
    expect(hubSlackAssistantEnabled(env({ VERCEL_ENV: "production" }))).toBe(false);
  });

  it("is off on previews, locally and for values other than 1 / true", () => {
    expect(hubSlackAssistantEnabled(env({ HUB_SLACK_ASSISTANT_ENABLED: "1", VERCEL_ENV: "preview" }))).toBe(false);
    expect(hubSlackAssistantEnabled(env({ HUB_SLACK_ASSISTANT_ENABLED: "1" }))).toBe(false);
    expect(hubSlackAssistantEnabled(env({ HUB_SLACK_ASSISTANT_ENABLED: "yes", VERCEL_ENV: "production" }))).toBe(false);
    expect(
      hubSlackAssistantEnabled(
        env({ HUB_SLACK_ASSISTANT_ENABLED: "1", VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "1" })
      )
    ).toBe(false);
  });

  it("is on only when set on the live site", () => {
    expect(hubSlackAssistantEnabled(env({ HUB_SLACK_ASSISTANT_ENABLED: "1", VERCEL_ENV: "production" }))).toBe(true);
    expect(hubSlackAssistantEnabled(env({ HUB_SLACK_ASSISTANT_ENABLED: "true", VERCEL_ENV: "production" }))).toBe(true);
  });
});

describe("hubSlackAssistantLive", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.SLACK_ASSISTANT_BOT_TOKEN;
    delete process.env.SLACK_ASSISTANT_SIGNING_SECRET;
    process.env.SLACK_BOT_TOKEN = "xoxb-hub";
    process.env.SLACK_SIGNING_SECRET = "hub-secret";
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  const on = env({ HUB_SLACK_ASSISTANT_ENABLED: "1", VERCEL_ENV: "production" });

  it("needs the assistant app's own keys, not the hub app's", () => {
    expect(hubSlackAssistantLive(on)).toBe(false);
    process.env.SLACK_ASSISTANT_BOT_TOKEN = "xoxb-assistant";
    process.env.SLACK_ASSISTANT_SIGNING_SECRET = "assistant-secret";
    expect(hubSlackAssistantLive(on)).toBe(true);
    expect(hubSlackAssistantLive(env({ HUB_SLACK_ASSISTANT_ENABLED: "1", VERCEL_ENV: "preview" }))).toBe(false);
  });

  it("knows whether the model key is set", () => {
    expect(hubSlackAssistantModelReady(env({}))).toBe(false);
    expect(hubSlackAssistantModelReady(env({ ANTHROPIC_API_KEY: "k" }))).toBe(true);
  });
});
