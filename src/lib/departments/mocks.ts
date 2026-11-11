import type {
  DepartmentBudget,
  DepartmentCluster,
  DepartmentPerson,
  HubService,
  OkrObjective,
  Rock,
} from "@/lib/departments/ui-contract";

/** Not on the API payload. HomeDashboard.okrCheckInsDue is an empty tuple. */
export interface OkrCheckIn {
  id: string;
  departmentSlug: string;
  cycleName: string;
  dueOn: string;
  completed: boolean;
  href: string;
}

/** Local until a tools field exists on the department payload. */
export interface DepartmentTool {
  label: string;
  href: string;
  moduleId: string;
}

/**
 * Mock stand-in for staff ministries, services, rocks and budgets.
 * The app reads this file until the department API is wired. It is not
 * test-only. Ministry names and slugs match the live list. People and
 * amounts are placeholders, not staff.
 *
 * Language is "FFSA staff with ministries under them".
 * Woven is inactive. Part-time ministries, Rooted Christian Academy
 * and No Ministry are real rows and are not department homes.
 *
 * Rand amounts are placeholders until finance projects are linked.
 * They are not live Xero figures.
 */

export const STAFF_LANGUAGE = "FFSA staff with ministries under them";

export const CURRENT_QUARTER = "2026 Q4";

export const OKR_CYCLE = {
  name: "2026",
  slug: "2026",
  href: "/okrs?cycle=2026",
} as const;

export const CLUSTER_LABEL: Record<DepartmentCluster, string> = {
  leadership: "Leadership",
  inward: "Inward",
  outward: "Outward",
  backbone: "Backbone",
  alongside: "Alongside",
};

const tool = (label: string, href: string, moduleId: string): DepartmentTool => ({
  label,
  href,
  moduleId,
});

const OKRS = tool("OKRs", OKR_CYCLE.href, "okrs");
const ROSTER = tool("Ministries roster", "/ministry", "ministry");

interface HomeSeed {
  slug: string;
  name: string;
  cluster: DepartmentCluster;
  parentSlug?: string;
  purpose: string;
  memberCount: number;
  people: DepartmentPerson[];
  tools: DepartmentTool[];
  objectives?: OkrObjective[];
}

function placeholderEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`;
}

const leader = (name: string): DepartmentPerson => ({
  name,
  capacity: "leader",
  email: placeholderEmail(name),
});

const HOMES: HomeSeed[] = [
  {
    slug: "leadership_team",
    name: "Leadership Team",
    cluster: "leadership",
    purpose: "Holds the whole base: direction, and the staff ministries under them.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [
      tool("Staff decisions", "/staff-decisions", "staff-decisions"),
      tool("Org chart", "/org-chart", "org-chart"),
      OKRS,
      ROSTER,
    ],
    objectives: [
      {
        title: "Keep a lead named on every staff ministry",
        keyResults: [
          { id: "lt-kr-1", label: null, description: "Every home has a named lead", status: "in_progress" },
        ],
      },
    ],
  },
  {
    slug: "prayer_and_worship",
    name: "Prayer & Worship",
    cluster: "inward",
    purpose: "Runs the prayer room, worship, and the weekly sets.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [tool("Prayer room", "/prayer-room", "prayer-room"), OKRS, ROSTER],
    objectives: [
      {
        title: "Cover the morning, noon and night bands",
        keyResults: [
          { id: "pw-kr-1", label: "Bands", description: "Morning, noon and night are covered", status: "in_progress" },
        ],
      },
      {
        title: "Sign off worship leads for the term",
        keyResults: [
          { id: "pw-kr-2", label: null, description: "Worship leads signed off", status: "stuck" },
        ],
      },
    ],
  },
  {
    slug: "training",
    name: "Training",
    cluster: "inward",
    purpose: "Runs the schools and the classroom.",
    memberCount: 1,
    people: [leader("Test Leader A")],
    tools: [tool("Training", "/schools", "schools"), OKRS, ROSTER],
    objectives: [
      {
        title: "Publish the next school dates",
        keyResults: [
          { id: "tr-kr-1", label: null, description: "Dates are published", status: "moving_forward" },
        ],
      },
    ],
  },
  {
    slug: "education",
    name: "Ed for Life",
    cluster: "inward",
    parentSlug: "training",
    purpose: "Education for life. Sits under Training, with its own roster.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [tool("Training", "/schools", "schools"), OKRS, ROSTER],
  },
  {
    slug: "hulk",
    name: "HULC",
    cluster: "outward",
    purpose: "Campus ministry.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [OKRS, ROSTER],
  },
  {
    slug: "project_54",
    name: "Project 54",
    cluster: "outward",
    purpose: "Nations work and church planting.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [OKRS, ROSTER],
  },
  {
    slug: "1040",
    name: "1040",
    cluster: "outward",
    purpose: "Discipleship and outreach.",
    memberCount: 1,
    people: [leader("Test Leader A")],
    tools: [OKRS, ROSTER],
  },
  {
    slug: "events",
    name: "Events",
    cluster: "outward",
    purpose: "Runs events the base signs up for.",
    memberCount: 1,
    people: [leader("Test Leader A")],
    tools: [tool("Events", "/events", "events"), OKRS, ROSTER],
  },
  {
    slug: "operations",
    name: "Operations",
    cluster: "backbone",
    purpose: "Runs the base day to day, including spaces and vehicles.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [
      tool("Bookings", "/bookings", "bookings"),
      tool("Spaces", "/bookings/spaces", "bookings"),
      tool("Vehicles", "/bookings/vehicles", "bookings"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "finances_legal",
    name: "Finances & Legal",
    cluster: "backbone",
    purpose: "Money and legal for FFSA in South Africa.",
    memberCount: 1,
    people: [leader("Test Leader A")],
    tools: [
      tool("Finance", "/finance", "finance"),
      tool("Legal", "/consents", "legal"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "media",
    name: "Media",
    cluster: "backbone",
    purpose: "Brand, and the gear the base hires.",
    memberCount: 1,
    people: [leader("Test Leader A")],
    tools: [
      tool("Brand kit", "/brand-kit", "brand-kit"),
      tool("Gear hire", "/bookings/equipment", "bookings"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "missio_ministry",
    name: "Missio Church",
    cluster: "alongside",
    purpose: "Church plant alongside FFSA. It is a staff ministry, so it has a full home.",
    memberCount: 2,
    people: [leader("Test Leader A"), leader("Test Leader B")],
    tools: [OKRS, ROSTER],
    objectives: [
      {
        title: "Keep the preaching rota a month ahead",
        keyResults: [
          { id: "mc-kr-1", label: null, description: "Rota stays a month ahead", status: "not_started" },
        ],
      },
    ],
  },
];

export interface MinistryRecord {
  slug: string;
  name: string;
  cluster: DepartmentCluster | null;
  parentSlug: string | null;
  parentName: string | null;
  purpose: string | null;
  memberCount: number;
  active: boolean;
  people: DepartmentPerson[];
  tools: DepartmentTool[];
  objectives: OkrObjective[];
}

export function ministryTools(slug: string): DepartmentTool[] {
  return MINISTRY_HOMES.find((home) => home.slug === slug)?.tools ?? [];
}

export const MINISTRY_HOMES: MinistryRecord[] = HOMES.map((home) => ({
  slug: home.slug,
  name: home.name,
  cluster: home.cluster,
  parentSlug: home.parentSlug ?? null,
  parentName: home.parentSlug ? (HOMES.find((row) => row.slug === home.parentSlug)?.name ?? null) : null,
  purpose: home.purpose,
  memberCount: home.memberCount,
  active: true,
  people: home.people,
  tools: home.tools,
  objectives: home.objectives ?? [],
}));

/**
 * Donors & Dev is not a home. `parentSlug` stays null until the migration
 * sets `parent_id` to finances_legal. `FOLDED_INTO` is the fallback.
 */
export const FOLDED_MINISTRIES: {
  slug: string;
  name: string;
  purpose: string;
  memberCount: number;
  people: DepartmentPerson[];
  parentSlug: string | null;
  parentName: string | null;
}[] = [
  {
    slug: "donors_dev",
    name: "Donors & Dev",
    purpose: "Partners and development. No lead is set.",
    memberCount: 1,
    people: [],
    parentSlug: null,
    parentName: null,
  },
];

const link = (
  slug: string,
  role: HubService["owners"][number]["role"]
): HubService["owners"][number] => ({ slug, role });

export const SERVICES: HubService[] = [
  {
    id: "prayer_room",
    name: "Prayer room",
    summary: "Weekly sets, rosters and applications.",
    href: "/prayer-room",
    moduleId: "prayer-room",
    owners: [link("prayer_and_worship", "owner")],
    audience: "all_signed_in",
  },
  {
    id: "spaces",
    name: "Spaces",
    summary: "Book a room on the base.",
    href: "/bookings/spaces",
    moduleId: "bookings",
    owners: [link("operations", "owner")],
    audience: "all_signed_in",
  },
  {
    id: "vehicles",
    name: "Vehicles",
    summary: "Request a vehicle from the fleet.",
    href: "/bookings/vehicles",
    moduleId: "bookings",
    owners: [link("operations", "owner")],
    audience: "all_signed_in",
  },
  {
    id: "gear_hire",
    name: "Gear hire",
    summary: "Hire equipment from the catalogue.",
    href: "/hire",
    moduleId: "bookings",
    owners: [
      link("prayer_and_worship", "owner"),
      link("operations", "owner"),
      link("media", "owner"),
    ],
    audience: "all_signed_in",
  },
  {
    id: "brand_kit",
    name: "Brand kit",
    summary: "Palette, logos and voice for emails and event pages.",
    href: "/brand-kit",
    moduleId: "brand-kit",
    owners: [link("media", "owner")],
    audience: "owners_only",
  },
  {
    id: "communications",
    name: "Communications",
    summary: "Announcements and partner updates.",
    href: "/communications",
    moduleId: "communications",
    owners: [
      link("media", "manager"),
      link("hulk", "access"),
      link("leadership_team", "access"),
    ],
    audience: "owners_only",
  },
  {
    id: "contacts",
    name: "Contacts",
    summary: "The contact directory.",
    href: "/contacts",
    moduleId: "contacts",
    owners: [
      link("media", "manager"),
      link("hulk", "manager"),
      link("leadership_team", "manager"),
    ],
    audience: "point_leaders",
  },
  {
    id: "evangelism",
    name: "Evangelism",
    summary: "Staff share testimonies. Shown only while the module is visible to you.",
    href: "/evangelism",
    moduleId: "evangelism",
    owners: [link("media", "moderator"), link("hulk", "moderator")],
    audience: "all_signed_in",
  },
];

export const ROCKS: Rock[] = [
  {
    id: "pw-rota",
    departmentSlug: "prayer_and_worship",
    title: "Agree the term's worship lead rota",
    owner: "Test Leader A",
    status: "off_track",
    dueOn: "2026-11-01",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "pw-coverage",
    departmentSlug: "prayer_and_worship",
    title: "Confirm night-band coverage for the week",
    owner: "Test Leader B",
    status: "on_track",
    dueOn: "2026-11-20",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "pw-advent",
    departmentSlug: "prayer_and_worship",
    title: "Write the Advent set plan",
    owner: "Test Leader A",
    status: "on_track",
    dueOn: null,
    quarter: CURRENT_QUARTER,
  },
  {
    id: "pw-notes",
    departmentSlug: "prayer_and_worship",
    title: "Close the October evaluation notes",
    owner: "Test Leader A",
    status: "done",
    dueOn: "2026-11-05",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "mc-rota",
    departmentSlug: "missio_ministry",
    title: "Confirm the December preaching rota",
    owner: "Test Leader A",
    status: "on_track",
    dueOn: "2026-11-18",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "lt-donors",
    departmentSlug: "leadership_team",
    title: "Name a lead for Donors & Dev",
    owner: "Test Leader A",
    status: "on_track",
    dueOn: "2026-11-12",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "tr-dates",
    departmentSlug: "training",
    title: "Publish the 2027 school dates",
    owner: "Test Leader A",
    status: "on_track",
    dueOn: "2026-11-15",
    quarter: CURRENT_QUARTER,
  },
];

export const BUDGETS: DepartmentBudget[] = [
  {
    departmentSlug: "prayer_and_worship",
    links: [
      {
        projectId: "test-worship",
        name: "Worship and prayer",
        budgetCents: 1_000_000,
        spentCents: 500_000,
        currency: "ZAR",
      },
    ],
  },
  {
    departmentSlug: "missio_ministry",
    links: [
      {
        projectId: null,
        name: "Missio",
        budgetCents: 2_000_000,
        spentCents: 1_000_000,
        currency: "ZAR",
      },
    ],
  },
  {
    departmentSlug: "training",
    links: [
      {
        projectId: "test-training",
        name: "Training",
        budgetCents: 5_000_000,
        spentCents: 2_000_000,
        currency: "ZAR",
      },
    ],
  },
  {
    departmentSlug: "operations",
    links: [
      {
        projectId: "test-fleet",
        name: "Motor vehicles",
        budgetCents: 3_000_000,
        spentCents: 1_000_000,
        currency: "ZAR",
      },
    ],
  },
  {
    departmentSlug: "events",
    links: [
      {
        projectId: "test-events",
        name: "Events",
        budgetCents: 1_000_000,
        spentCents: 500_000,
        currency: "ZAR",
      },
    ],
  },
  {
    departmentSlug: "media",
    links: [
      {
        projectId: "test-media",
        name: "Media",
        budgetCents: 2_000_000,
        spentCents: 1_000_000,
        currency: "ZAR",
      },
    ],
  },
];

export const OKR_CHECK_INS: OkrCheckIn[] = [
  {
    id: "pw-open",
    departmentSlug: "prayer_and_worship",
    cycleName: OKR_CYCLE.name,
    dueOn: "2026-11-30",
    completed: false,
    href: OKR_CYCLE.href,
  },
  {
    id: "pw-closed",
    departmentSlug: "prayer_and_worship",
    cycleName: OKR_CYCLE.name,
    dueOn: "2026-10-31",
    completed: true,
    href: OKR_CYCLE.href,
  },
  {
    id: "mc-open",
    departmentSlug: "missio_ministry",
    cycleName: OKR_CYCLE.name,
    dueOn: "2026-11-16",
    completed: false,
    href: OKR_CYCLE.href,
  },
  {
    id: "tr-open",
    departmentSlug: "training",
    cycleName: OKR_CYCLE.name,
    dueOn: "2026-11-12",
    completed: false,
    href: OKR_CYCLE.href,
  },
];

