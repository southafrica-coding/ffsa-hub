import { describe, expect, it } from "vitest";
import { hubFormsSlackEnabled } from "./flags";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("hubFormsSlackEnabled", () => {
  it("is off by default", () => {
    expect(hubFormsSlackEnabled(env({}))).toBe(false);
    expect(hubFormsSlackEnabled(env({ VERCEL_ENV: "production" }))).toBe(false);
  });

  it("is off on previews and for values other than 1 / true", () => {
    expect(hubFormsSlackEnabled(env({ HUB_FORMS_SLACK_ENABLED: "1", VERCEL_ENV: "preview" }))).toBe(false);
    expect(hubFormsSlackEnabled(env({ HUB_FORMS_SLACK_ENABLED: "yes", VERCEL_ENV: "production" }))).toBe(false);
    expect(
      hubFormsSlackEnabled(
        env({ HUB_FORMS_SLACK_ENABLED: "1", VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "1" })
      )
    ).toBe(false);
  });

  it("is on only when set on the live site", () => {
    expect(hubFormsSlackEnabled(env({ HUB_FORMS_SLACK_ENABLED: "1", VERCEL_ENV: "production" }))).toBe(true);
    expect(hubFormsSlackEnabled(env({ HUB_FORMS_SLACK_ENABLED: "true", VERCEL_ENV: "production" }))).toBe(true);
  });
});
