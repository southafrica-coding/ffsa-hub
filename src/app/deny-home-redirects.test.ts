import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Page-local denials. The condition stays; only the target is /home.
// middleware.ts and require-permission.ts are owned by other drafts.
const DENIALS: Array<[file: string, line: string]> = [
  ["src/app/(admin)/schools/page.tsx", 'if (!access.open) redirect("/home");'],
  [
    "src/app/(admin)/schools/[programId]/page.tsx",
    'if (!ltProgram) redirect("/home");',
  ],
  [
    "src/app/(admin)/staff-decisions/page.tsx",
    'if (!(await canUseStaffDecisions(supabase, user.id))) redirect("/home");',
  ],
  [
    "src/app/(admin)/users/[id]/page.tsx",
    'if (!canManagePermissions) redirect("/home");',
  ],
  ["src/app/(admin)/evangelism/page.tsx", 'if (!access.view) redirect("/home");'],
  [
    "src/app/(admin)/settings/page.tsx",
    'if (!(await callerIsAdmin(supabase, user.id))) redirect("/home");',
  ],
  [
    "src/app/(admin)/settings/slack/page.tsx",
    'if (!(await callerIsAdmin(supabase, user.id))) redirect("/home");',
  ],
  ["src/app/(admin)/teams/page.tsx", 'if (isHiddenFromNav("teams")) redirect("/home");'],
  ["src/app/(admin)/roles/page.tsx", 'redirect("/home");'],
  [
    "src/app/(admin)/ministry/(index)/page.tsx",
    'if (!seesEverything && ledIds.length === 0) redirect("/home");',
  ],
  ["src/app/(admin)/ministry/[id]/page.tsx", 'if (!canView) redirect("/home");'],
  [
    "src/app/(admin)/ministry/staff/[userId]/page.tsx",
    'if (!(await canViewStaffCard(supabase, user.id, userId))) redirect("/home");',
  ],
  ["src/app/(admin)/mission/page.tsx", 'if (isHiddenFromNav("mission")) redirect("/home");'],
  ["src/app/(admin)/communications/brand/page.tsx", 'redirect("/home");'],
  [
    "src/app/(portal)/my-mission/page.tsx",
    'if (isHiddenFromNav("my-mission")) redirect("/home");',
  ],
];

describe("page denials land on /home", () => {
  it.each(DENIALS)("%s keeps its condition and targets /home", (file, line) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain(line);
    expect(source).not.toContain('redirect("/dashboard")');
  });

  it("sends a donor-statements denial back to finance with the notice", () => {
    const source = readFileSync("src/app/(admin)/finance/donor-statements/page.tsx", "utf8");
    expect(source).toContain('redirect("/finance?notice=statements-access")');
    expect(source).not.toContain('redirect("/finance")');
    expect(source).not.toContain('redirect("/dashboard")');
  });
});
