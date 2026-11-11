import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const admin = path.resolve(__dirname);
const shared = 'export { default } from "../admin-loading"';

describe("admin loading boundaries", () => {
  it("gives every admin route segment except departments the shared skeleton", () => {
    const missing: string[] = [];
    for (const name of readdirSync(admin)) {
      if (name === "departments") continue;
      const dir = path.join(admin, name);
      if (!statSync(dir).isDirectory()) continue;
      try {
        statSync(path.join(dir, "page.tsx"));
      } catch {
        continue;
      }
      const loading = path.join(dir, "loading.tsx");
      let text = "";
      try {
        text = readFileSync(loading, "utf8");
      } catch {
        missing.push(name);
        continue;
      }
      if (!text.includes(shared)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
