import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as departments from "@/lib/departments";

const ROOT = path.resolve(__dirname, "../../..");

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("department public entry", () => {
  it("exports exactly the four viewer wrappers at runtime", () => {
    expect(Object.keys(departments).sort()).toEqual([
      "loadDepartmentHomeForViewer",
      "loadDepartmentsIndexForViewer",
      "loadHomeForViewer",
      "loadServicesForViewer",
    ]);
  });

  it("keeps the internal modules inside departments, services, and the API", () => {
    const allowed = ["src/lib/departments/", "src/lib/services/", "src/app/api/"];
    const offenders: string[] = [];
    for (const file of filesUnder(path.join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("/internal/") && !text.includes("departments/internal") && !text.includes("services/internal")) {
        continue;
      }
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      if (!allowed.some((prefix) => relative.startsWith(prefix))) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});
