import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TONE } from "@/components/ffsa";
import { HIRE, HIRE_CSS } from "@/lib/equipment/hire-theme";

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function toneHex(tone: string): string {
  const match = tone.match(/#([0-9A-Fa-f]{6})/);
  if (!match) throw new Error(`No hex colour in tone class: ${tone}`);
  return `#${match[1]}`;
}

const HIRE_SURFACES = ["bg", "surface", "surface2", "hover"] as const;

const ROOT = path.resolve(__dirname, "../../../..");
const APP = path.join(ROOT, "src/app");

/** The two screens this batch is allowed to change. */
const SOURCES = [
  "src/app/(admin)/finance/page.tsx",
  "src/app/(public)/hire/_components/store-chrome.tsx",
];

type Segment = string | { dynamic: true; catchAll: boolean };

function extractInternalHrefs(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bhref\s*:\s*(['"`])(\/[^'"`]*)\1/g,
    /\bhref\s*=\s*(['"`])(\/[^'"`]*)\1/g,
    /\bhref=\{dated\(\s*(['"`])(\/[^'"`]*)\1/g,
    /\bhref=\{`(\/[^`]*)`\}/g,
    /\bhref=\{\s*(['"])(\/[^'"]*)\1\s*\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const href = match[2] ?? match[1];
      if (href?.startsWith("/")) found.push(href);
    }
  }
  return found;
}

function routeOf(dir: string): Segment[] {
  const rel = path.relative(APP, dir);
  if (!rel || rel === ".") return [];
  return rel.split(path.sep).flatMap((segment): Segment[] => {
    if (segment.startsWith("(") && segment.endsWith(")")) return [];
    if (segment.startsWith("[[...") || segment.startsWith("[...")) {
      return [{ dynamic: true, catchAll: true }];
    }
    if (segment.startsWith("[") && segment.endsWith("]")) {
      return [{ dynamic: true, catchAll: false }];
    }
    return [segment];
  });
}

function collectRoutes(dir: string, routes: Segment[][] = []): Segment[][] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      collectRoutes(full, routes);
      continue;
    }
    if (name === "page.tsx" || name === "page.ts" || name === "page.jsx") {
      routes.push(routeOf(dir));
    }
  }
  return routes;
}

function pageExists(href: string, routes: Segment[][]): boolean {
  const pathname = href.split(/[?#]/)[0];
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.includes("${") ? null : decodeURIComponent(segment)));

  return routes.some((route) => {
    let partIndex = 0;
    let routeIndex = 0;
    while (partIndex < parts.length && routeIndex < route.length) {
      const routeSegment = route[routeIndex];
      if (typeof routeSegment !== "string" && routeSegment.catchAll) return true;
      if (typeof routeSegment !== "string") {
        partIndex += 1;
        routeIndex += 1;
        continue;
      }
      if (parts[partIndex] !== routeSegment) return false;
      partIndex += 1;
      routeIndex += 1;
    }
    return partIndex === parts.length && routeIndex === route.length;
  });
}

describe("finance and hire internal hrefs", () => {
  const routes = collectRoutes(APP);

  it.each(SOURCES)("%s only points at a page that exists", (file) => {
    const hrefs = extractInternalHrefs(readFileSync(path.join(ROOT, file), "utf8"));
    expect(hrefs.length).toBeGreaterThan(0);
    const missing = hrefs.filter((href) => !pageExists(href, routes));
    expect(missing).toEqual([]);
  });

  it("keeps Coming soon as plain text with AA contrast", () => {
    const finance = readFileSync(path.join(ROOT, SOURCES[0]), "utf8");
    const hire = readFileSync(path.join(ROOT, SOURCES[1]), "utf8");
    expect(finance).not.toContain("opacity-55");
    expect(finance).not.toContain("aria-disabled");
    expect(finance).toContain('aria-hidden="true"');
    expect(hire).not.toContain("aria-disabled");
    expect(HIRE_CSS).toContain(`--hire-dim: ${HIRE.dim}`);
    expect(HIRE_CSS).toContain(`--hire-dim-edge: ${HIRE.dimEdge}`);
    expect(contrastRatio(toneHex(TONE.quiet), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    for (const name of HIRE_SURFACES) {
      expect(contrastRatio(HIRE.dim, HIRE[name]), `dim text on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(HIRE.dimEdge, HIRE[name]), `dim edge on ${name}`).toBeGreaterThanOrEqual(3);
    }
    expect(luminance(HIRE.dim)).toBeLessThan(luminance(HIRE.muted));
  });
});
