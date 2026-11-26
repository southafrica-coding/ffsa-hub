import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamNotFound, AutoRecapCard } from "./ui";
import { L10HomeLinkView } from "@/app/(admin)/departments/[slug]/department-view";
import { TeamPickerScreen, type TeamPickerCard } from "./team-picker";
import type { L10Headline, L10Team } from "./types";

function team(id: string, name: string, slug: string): L10Team {
  return {
    id,
    department_id: "dept-ops",
    slug,
    name,
    meeting_weekday: 3,
    meeting_time: "09:00:00",
    meeting_timezone: "Africa/Johannesburg",
    facilitator_id: null,
    slack_channel_id: null,
    recap_source_team_id: null,
    sort_order: 0,
    is_active: true,
  };
}

function card(row: L10Team): TeamPickerCard {
  return {
    team: row,
    stats: { openIssues: 1, openTodos: 2, rocksOnTrack: 3, rocksTotal: 4 },
    live: null,
  };
}

const now = Date.UTC(2026, 10, 26, 7, 55);

describe("L10 is department-agnostic", () => {
  it("renders another department's slug, name and teams, not a fixed Prayer & Worship set", () => {
    const html = renderToStaticMarkup(
      <TeamPickerScreen
        slug="operations"
        departmentName="Operations"
        cards={[card(team("host", "Host", "host")), card(team("setup", "Setup", "setup"))]}
        now={now}
      />
    );
    expect(html).toContain("Operations");
    expect(html).toContain("Host");
    expect(html).toContain("Setup");
    expect(html).toContain("/departments/operations/l10/host");
    expect(html).toContain("/departments/operations/l10/setup");
    expect(html).not.toMatch(/Prayer|Worship|Production|Team 3/i);
  });

  it("shows no Add-team placeholder (no create-team API yet) and lets the rocks label wrap", () => {
    const html = renderToStaticMarkup(
      <TeamPickerScreen slug="operations" departmentName="Operations" cards={[card(team("host", "Host", "host"))]} now={now} />
    );
    expect(html).not.toMatch(/Add an L10 team/i);
    expect(html).not.toContain("aria-disabled");
    expect(html).toMatch(/class="[^"]*statLabelWrap[^"]*">Rocks on track</);
  });

  it("shows a friendly not-found on a team page (non-members get a 404)", () => {
    const html = renderToStaticMarkup(<TeamNotFound href="/departments/operations/l10" />);
    expect(html).toContain("L10 team not found");
    expect(html).toContain("isn&#x27;t here, or you don&#x27;t have access");
    expect(html).toContain("/departments/operations/l10");
    expect(html).not.toMatch(/Prayer|Worship/i);
  });

  it("renders an expandable auto recap from the paired team, dismissable and not editable", () => {
    const headline: L10Headline = {
      id: "auto-1",
      body: "Production rated 8.5. Four new to-dos, two issues kept.",
      author_id: null,
      source_meeting_id: "meet-live",
      created_at: "2026-11-26T08:00:00.000Z",
      is_auto: true,
      recap_of_meeting_id: "meet-prod",
      dismissed_at: null,
      recap_source_team_name: "Production",
    };
    const html = renderToStaticMarkup(
      <AutoRecapCard headline={headline} sourceTeamName="Production" onDismiss={() => undefined} />
    );
    expect(html).toContain("Auto recap from Production");
    expect(html).toContain("Auto");
    expect(html).toContain("Production rated 8.5");
    expect(html).toMatch(/>Dismiss</);
    expect(html).toContain("<details");
    expect(html).not.toMatch(/>Edit</);
    expect(html).not.toMatch(/>Delete</);
    expect(html).not.toMatch(/>Undo</);
    const dismissed = renderToStaticMarkup(
      <AutoRecapCard
        headline={{ ...headline, dismissed_at: "2026-11-26T09:00:00.000Z" }}
        sourceTeamName="Production"
        onRestore={() => undefined}
      />
    );
    expect(dismissed).toMatch(/>Undo</);
    expect(dismissed).not.toMatch(/>Dismiss</);
    expect(dismissed).not.toMatch(/>Edit</);
    expect(dismissed).not.toMatch(/>Delete</);
  });

  it("renders a department-home L10 link for any slug, with no department or team names hardcoded", () => {
    const html = renderToStaticMarkup(<L10HomeLinkView slug="operations" />);
    expect(html).toContain("/departments/operations/l10");
    expect(html).toContain("L10");
    expect(html).toContain("Weekly Level 10 meetings");
    expect(html).not.toMatch(/Prayer|Worship|Production/i);
  });

  it("offers a Join the open meeting action without hardcoding a department or team", () => {
    const html = renderToStaticMarkup(
      <TeamPickerScreen
        slug="operations"
        departmentName="Operations"
        cards={[card(team("host", "Host", "host"))]}
        now={now}
        startError="conflict"
        startErrorCode="l10_meeting_already_open"
        joinHref="/departments/operations/l10/host/meetings/meet-open"
      />
    );
    expect(html).toContain("This team already has a meeting running.");
    expect(html).toContain("Join the open meeting");
    expect(html).toContain("/departments/operations/l10/host/meetings/meet-open");
    expect(html).not.toMatch(/Prayer|Worship|Production/i);
  });
});
