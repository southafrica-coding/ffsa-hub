import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  getReferenceRequestSummaries,
  getReferenceRequestsByApplication,
  updateReferenceRequest,
} from "@/services/schools";
import { REFERENCE_EDIT_SELECT } from "@/lib/references/edit-reference-contact";
import {
  REFERENCE_REQUEST_COLUMN_LIST,
  REFERENCE_REQUEST_COLUMNS,
  REFERENCE_REQUEST_WITH_SLOT,
  REFERENCE_REQUEST_WITH_SLOT_LABEL,
} from "@/lib/references/reference-request-columns";

const SRC = path.resolve(__dirname, "../..");
const ROOT = path.resolve(SRC, "..");

const KNOWN: Record<string, string> = {
  REFERENCE_EDIT_SELECT,
  REFERENCE_REQUEST_COLUMN_LIST,
  REFERENCE_REQUEST_WITH_SLOT,
  REFERENCE_REQUEST_WITH_SLOT_LABEL,
};

/** Service functions that filter or return token. Every caller must pass service role. */
const TOKEN_FUNCTIONS = new Set([
  "createReferenceRequest",
  "getReferenceRequestByToken",
  "submitReference",
]);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts")) continue;
    out.push(full);
  }
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      buf += c;
      if (c === "\\") {
        buf += body[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    if (c === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

/** True when a select list asks for reference_requests.token or every column. */
export function selectRequestsToken(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "" || trimmed === "*") return true;
  for (const part of splitTopLevel(trimmed)) {
    const head = part.trim().replace(/^["'`]+|["'`]+$/g, "");
    if (head === "*" || head.startsWith("*")) return true;
    const name = head.split(/[\s(:.!]/)[0]?.replace(/["'`]/g, "") ?? "";
    if (name === "token") return true;
  }
  return false;
}

function readConst(name: string, fileText: string): string | null {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*`);
  const m = re.exec(fileText);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  let quote: string | null = null;
  for (; i < fileText.length; i++) {
    const c = fileText[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === ";" && depth === 0) return fileText.slice(m.index + m[0].length, i).trim();
  }
  return null;
}

function expand(expr: string, fileText: string, seen = new Set<string>()): string {
  const trimmed = expr.trim();
  if (KNOWN[trimmed]) return KNOWN[trimmed];
  if (seen.has(trimmed)) return trimmed;
  seen.add(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => {
      return expand(name, fileText, seen);
    });
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    const raw = readConst(trimmed, fileText);
    if (raw) return expand(raw, fileText, seen);
  }
  return trimmed.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => expand(name, fileText, seen));
}

function statementEnd(text: string, fromIndex: number): number {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let quote: string | null = null;
  for (let i = fromIndex; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(") paren += 1;
    else if (c === ")") paren -= 1;
    else if (c === "[") bracket += 1;
    else if (c === "]") bracket -= 1;
    else if (c === "{") brace += 1;
    else if (c === "}") brace -= 1;
    else if (c === ";" && paren === 0 && bracket === 0 && brace === 0) return i;
  }
  return text.length;
}

function selectArg(statement: string): string | null {
  const at = statement.search(/\.select\s*\(/);
  if (at < 0) return null;
  const open = statement.indexOf("(", at);
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < statement.length; i++) {
    const c = statement[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(open + 1, i).trim();
    }
  }
  return null;
}

type Site = {
  file: string;
  line: number;
  fn: string | null;
  admin: boolean;
  requestsToken: boolean;
  filtersToken: boolean;
};

function sitesIn(file: string): Site[] {
  const text = readFileSync(file, "utf8");
  const sites: Site[] = [];
  const re = /\.from\(\s*["']reference_requests["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const end = statementEnd(text, match.index);
    const statement = text.slice(match.index, end);
    const prelude = text.slice(Math.max(0, match.index - 300), match.index);
    const recv = prelude.match(/(?:await\s+)?(?:\(\s*)?([A-Za-z0-9_]+)(?:\s+as\s+any\s*\))?\s*$/);
    const fns = [...text.slice(0, match.index).matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)];
    const arg = selectArg(statement);
    const expanded = arg == null ? "" : expand(arg, text);
    sites.push({
      file: path.relative(ROOT, file),
      line: text.slice(0, match.index).split("\n").length,
      fn: fns.length ? fns[fns.length - 1][1] : null,
      admin: recv?.[1] === "admin" || recv?.[1] === "adminSupabase",
      requestsToken: arg != null && (arg === "" || selectRequestsToken(expanded)),
      filtersToken: /\.eq\(\s*["']token["']/.test(statement),
    });
  }
  return sites;
}

function productionFiles(): string[] {
  const files: string[] = [];
  walk(SRC, files);
  return files;
}

function enclosingFunction(text: string, index: number): string {
  const before = text.slice(0, index);
  const starts = [...before.matchAll(/(?:async\s+)?function\s+[A-Za-z0-9_]+/g)];
  if (starts.length === 0) return text;
  return text.slice(starts[starts.length - 1].index);
}

describe("reference_requests reads do not ask the user client for token", () => {
  const found = productionFiles().flatMap(sitesIn);

  it("finds the call sites", () => {
    expect(found.length).toBeGreaterThan(15);
  });

  it("never uses select * or an empty select, and only admin paths name token", () => {
    const violations = found.filter((site) => {
      if (!site.requestsToken && !site.filtersToken) return false;
      if (site.fn && TOKEN_FUNCTIONS.has(site.fn)) return false;
      if (site.admin && site.requestsToken) return false;
      return true;
    });
    expect(violations).toEqual([]);
  });

  it("passes service role into the functions that still touch token", () => {
    const problems: string[] = [];
    for (const file of productionFiles()) {
      const text = readFileSync(file, "utf8");
      for (const name of TOKEN_FUNCTIONS) {
        const re = new RegExp(`(?<!function\\s)\\b${name}\\s*\\(\\s*([A-Za-z0-9_]+)`, "g");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          const arg = match[1];
          const body = enclosingFunction(text, match.index);
          const assigned = new RegExp(
            `(?:const|let)\\s+${arg}\\s*=\\s*(?:await\\s+)?createAdminClient\\s*\\(`
          ).test(body);
          if (!assigned) {
            problems.push(
              `${path.relative(ROOT, file)}:${text.slice(0, match.index).split("\n").length} ${name}(${arg})`
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the user-facing service reads off token", async () => {
    const fake = createFakeSupabase({ resolve: () => ({ data: [] }) });
    await getReferenceRequestsByApplication(fake.client, "app");
    await getReferenceRequestSummaries(fake.client, ["app"]);
    await updateReferenceRequest(fake.client, "ref", { referee_name: "Pat" });
    for (const query of fake.queries) {
      expect(query.table).toBe("reference_requests");
      expect(query.columns ?? "").not.toContain("*");
      expect(selectRequestsToken(query.columns ?? "")).toBe(false);
    }
    expect(fake.queries.map((query) => query.columns)).toContain(REFERENCE_REQUEST_WITH_SLOT);
  });

  it("does not query reference_requests from the mobile app", () => {
    const mobile = path.join(ROOT, "apps/mobile/src");
    const files: string[] = [];
    walk(mobile, files);
    const hits = files.filter((file) =>
      readFileSync(file, "utf8").includes('from("reference_requests")')
    );
    expect(hits).toEqual([]);
  });
});

describe("migration 328 column grant", () => {
  const sql = readFileSync(
    path.join(ROOT, "supabase/migrations/328_reference_requests_hide_token.sql"),
    "utf8"
  );

  function grantedColumns(): string[] {
    const body = /GRANT SELECT\s*\(([\s\S]*?)\)\s*ON TABLE public\.reference_requests TO authenticated/.exec(sql)?.[1] ?? "";
    return body
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
  }

  it("grants authenticated exactly the typed column list, without token", () => {
    expect(grantedColumns()).toEqual([...REFERENCE_REQUEST_COLUMNS]);
    expect(grantedColumns()).not.toContain("token");
    expect(REFERENCE_EDIT_SELECT.startsWith(`${REFERENCE_REQUEST_COLUMN_LIST},`)).toBe(true);
    expect(selectRequestsToken(REFERENCE_EDIT_SELECT)).toBe(false);
  });

  it("revokes table-wide SELECT and leaves INSERT and UPDATE grants alone", () => {
    expect(sql).toMatch(/REVOKE SELECT ON TABLE public\.reference_requests FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE SELECT ON TABLE public\.reference_requests FROM anon/);
    expect(sql).toMatch(/REVOKE SELECT ON TABLE public\.reference_requests FROM authenticated/);
    expect(sql).not.toMatch(/REVOKE\s+(ALL|INSERT|UPDATE)\b/);
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|ALL)\b/);
  });

  it("has no view or function that selects reference_requests for authenticated", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const hits: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".sql")) continue;
      const text = readFileSync(path.join(dir, name), "utf8");
      if (/create\s+(or\s+replace\s+)?view[\s\S]{0,400}reference_requests/i.test(text)) {
        hits.push(`${name} view`);
      }
      if (/from\s+public\.reference_requests/i.test(text)) hits.push(`${name} from`);
    }
    expect(hits).toEqual([]);
  });
});
