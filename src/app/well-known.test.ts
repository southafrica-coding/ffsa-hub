import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import nextConfig from "../../next.config";

// The phone app's link-association files. They hold PLACEHOLDER ids until
// the Apple Team ID, bundle id and Android signing fingerprint exist; these
// tests check they stay valid JSON in the shape Apple / Google read, and
// that they are served as application/json.

const wellKnown = (name: string) =>
  readFileSync(path.join(__dirname, "../../public/.well-known", name), "utf8");

describe("/.well-known app-link files", () => {
  it("apple-app-site-association parses and lists the app's link paths", () => {
    const aasa = JSON.parse(wellKnown("apple-app-site-association"));
    const details = aasa.applinks.details;
    expect(details).toHaveLength(1);
    expect(details[0].appIDs).toHaveLength(1);
    expect(details[0].components.map((c: { "/": string }) => c["/"])).toEqual([
      "/auth/confirm*",
      "/setup/*",
      "/reset-password*",
      "/e/*",
    ]);
  });

  it("assetlinks.json parses in Google's shape", () => {
    const links = JSON.parse(wellKnown("assetlinks.json"));
    expect(links[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(links[0].target.namespace).toBe("android_app");
    expect(typeof links[0].target.package_name).toBe("string");
    expect(links[0].target.sha256_cert_fingerprints).toHaveLength(1);
  });

  it("both are served as application/json", async () => {
    const rules = await nextConfig.headers!();
    for (const source of [
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, source).toBeDefined();
      expect(rule!.headers).toContainEqual({ key: "Content-Type", value: "application/json" });
    }
  });
});
