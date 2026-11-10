import type {
  DepartmentBudget,
  DepartmentCluster,
  DepartmentPerson,
  DepartmentSummary,
  DepartmentTool,
  DepartmentViewer,
  HubService,
  OkrCheckIn,
  OkrObjective,
  Rock,
} from "@/types/departments";

/**
 * Mock stand-in for staff ministries, services, rocks and budgets.
 * Names, clusters, counts and leaders are the live list from the
 * Departments & Services plan (9 Nov 2026, Africa/Johannesburg).
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

/**
 * URL forms that must 404. Includes the live `staff_ministries.slug`
 * and a hyphenated alias, so neither spelling grows a home by accident.
 */
export const EXCLUDED_DEPARTMENT_SLUGS = [
  "rooted-christian-academy",
  "rca",
  "rooted_christian_academy",
  "brave-love",
  "brave_love",
  "hope-again",
  "hope_again",
  "watchmen",
  "the-watchmen",
  "old-age-home",
  "old-age-homes",
  "old_age_home",
  "old_age_homes",
  "no-ministry",
  "no_ministry",
  "woven",
  "inside-ministry",
  "inside_ministry",
  "outside-ministry",
  "outside_ministry",
] as const;

const tool = (label: string, href: string, moduleId: string): DepartmentTool => ({
  label,
  href,
  moduleId,
});

const OKRS = tool("OKRs", OKR_CYCLE.href, "okrs");
const ROSTER = tool("Ministries roster", "/ministry", "ministry");

interface HomeSeed {
  slug: string;
  ministrySlug: string;
  aliases?: string[];
  name: string;
  cluster: DepartmentCluster;
  parentSlug?: string;
  purpose: string;
  memberCount: number;
  people: DepartmentPerson[];
  tools: DepartmentTool[];
  objectives?: OkrObjective[];
}

const leader = (name: string, role?: string): DepartmentPerson => ({
  name,
  capacity: "leader",
  ...(role ? { role } : {}),
});

const HOMES: HomeSeed[] = [
  {
    slug: "leadership-team",
    ministrySlug: "leadership_team",
    aliases: ["leadership_team"],
    name: "Leadership Team",
    cluster: "leadership",
    purpose: "Holds the whole base: direction, and the staff ministries under them.",
    memberCount: 7,
    people: [
      leader("Gabriël Strydom", "Visionary"),
      leader("Caleb Cox", "Integrator"),
      leader("Allyson Roestorf", "Operator"),
      leader("Brendon Homan"),
      leader("Eduard Schoch"),
      leader("Hanno"),
      leader("Jaco"),
    ],
    tools: [
      tool("Staff decisions", "/staff-decisions", "staff-decisions"),
      tool("Org chart", "/org-chart", "org-chart"),
      OKRS,
      ROSTER,
    ],
    objectives: [
      { title: "Keep a lead named on every staff ministry", tone: "on_track" },
    ],
  },
  {
    slug: "prayer-worship",
    ministrySlug: "prayer_and_worship",
    aliases: ["prayer_and_worship", "prayer-and-worship"],
    name: "Prayer & Worship",
    cluster: "inward",
    purpose: "Runs the prayer room, worship, and the weekly sets.",
    memberCount: 16,
    people: [
      leader("Davis Crouch"),
      leader("Jack Kilman"),
      leader("Jolizna Roestorf"),
    ],
    tools: [tool("Prayer room", "/prayer-room", "prayer-room"), OKRS, ROSTER],
    objectives: [
      { title: "Cover the morning, noon and night bands", tone: "on_track" },
      { title: "Sign off worship leads for the term", tone: "stuck" },
    ],
  },
  {
    slug: "training",
    ministrySlug: "training",
    name: "Training",
    cluster: "inward",
    purpose: "Runs the schools and the classroom.",
    memberCount: 36,
    people: [leader("Allyson Roestorf", "School leaders sit with her")],
    tools: [tool("Training", "/schools", "schools"), OKRS, ROSTER],
    objectives: [{ title: "Publish the next school dates", tone: "on_track" }],
  },
  {
    slug: "ed-for-life",
    ministrySlug: "education",
    aliases: ["education", "ed_for_life"],
    name: "Ed for Life",
    cluster: "inward",
    parentSlug: "training",
    purpose: "Education for life. Sits under Training, with its own roster.",
    memberCount: 3,
    people: [leader("Cassandra Cullen"), leader("Jaco Diederiks")],
    tools: [tool("Training", "/schools", "schools"), OKRS, ROSTER],
  },
  {
    slug: "hulc",
    ministrySlug: "hulk",
    aliases: ["hulk"],
    name: "HULC",
    cluster: "outward",
    purpose: "Campus ministry.",
    memberCount: 14,
    people: [leader("Heinrich"), leader("Lené"), leader("Sarah"), leader("Wimpie")],
    tools: [OKRS, ROSTER],
  },
  {
    slug: "project-54",
    ministrySlug: "project_54",
    aliases: ["project_54"],
    name: "Project 54",
    cluster: "outward",
    purpose: "Nations work and church planting.",
    memberCount: 21,
    people: [
      leader("Eduard Schoch"),
      leader("Mercy Johnson"),
      leader("Veronica Degenaar"),
    ],
    tools: [OKRS, ROSTER],
  },
  {
    slug: "1040",
    ministrySlug: "1040",
    name: "1040",
    cluster: "outward",
    purpose: "Discipleship and outreach.",
    memberCount: 9,
    people: [leader("Marno Crathorne")],
    tools: [OKRS, ROSTER],
  },
  {
    slug: "events",
    ministrySlug: "events",
    name: "Events",
    cluster: "outward",
    purpose: "Runs events the base signs up for.",
    memberCount: 2,
    people: [leader("Brendon Homan")],
    tools: [tool("Events", "/events", "events"), OKRS, ROSTER],
  },
  {
    slug: "operations",
    ministrySlug: "operations",
    name: "Operations",
    cluster: "backbone",
    purpose: "Runs the base day to day, including spaces and vehicles.",
    memberCount: 6,
    people: [
      leader("Coreen Steyn"),
      leader("HE Steyn"),
      leader("Maché Van Zyl"),
      leader("Michelle Strydom"),
    ],
    tools: [
      tool("Bookings", "/bookings", "bookings"),
      tool("Spaces", "/bookings/spaces", "bookings"),
      tool("Vehicles", "/bookings/vehicles", "bookings"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "finances-legal",
    ministrySlug: "finances_legal",
    aliases: ["finances_legal", "finances-and-legal"],
    name: "Finances & Legal",
    cluster: "backbone",
    purpose: "Money and legal for FFSA in South Africa.",
    memberCount: 2,
    people: [leader("Coreen Steyn")],
    tools: [
      tool("Finance", "/finance", "finance"),
      tool("Legal", "/consents", "legal"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "media",
    ministrySlug: "media",
    name: "Media",
    cluster: "backbone",
    purpose: "Brand, and the gear the base hires.",
    memberCount: 3,
    people: [leader("Tosca Ferndale")],
    tools: [
      tool("Brand kit", "/brand-kit", "brand-kit"),
      tool("Gear hire", "/bookings/equipment", "bookings"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "donors-dev",
    ministrySlug: "donors_dev",
    aliases: ["donors_dev", "donors-and-dev"],
    name: "Donors & Dev",
    cluster: "backbone",
    purpose: "Partners and development. No lead is set.",
    memberCount: 1,
    people: [],
    tools: [
      tool("Communications", "/communications", "communications"),
      tool("Contacts", "/contacts", "contacts"),
      OKRS,
      ROSTER,
    ],
  },
  {
    slug: "missio-church",
    ministrySlug: "missio_ministry",
    aliases: ["missio_church", "missio_ministry", "missio-ministry"],
    name: "Missio Church",
    cluster: "alongside",
    purpose: "Church plant alongside FFSA. It is a staff ministry, so it has a full home.",
    memberCount: 9,
    people: [
      leader("Davis Crouch"),
      leader("Dwayne Roberts"),
      leader("Gabriël Strydom", "Lead pastor"),
    ],
    tools: [OKRS, ROSTER],
    objectives: [{ title: "Keep the preaching rota a month ahead", tone: "on_track" }],
  },
];

export interface MinistryRecord extends DepartmentSummary {
  aliases: string[];
  people: DepartmentPerson[];
  tools: DepartmentTool[];
  objectives: OkrObjective[];
}

export const MINISTRY_HOMES: MinistryRecord[] = HOMES.map((home) => ({
  slug: home.slug,
  ministrySlug: home.ministrySlug,
  aliases: home.aliases ?? [],
  name: home.name,
  cluster: home.cluster,
  parentSlug: home.parentSlug ?? null,
  purpose: home.purpose,
  memberCount: home.memberCount,
  active: true,
  people: home.people,
  tools: home.tools,
  objectives: home.objectives ?? [],
}));

export const SERVICES: HubService[] = [
  {
    id: "prayer-room",
    name: "Prayer room",
    summary: "Weekly sets, rosters and applications. Open to every signed-in person.",
    href: "/prayer-room",
    moduleId: "prayer-room",
    ownerSlug: "prayer-worship",
    ownerAssumed: false,
  },
  {
    id: "spaces",
    name: "Spaces",
    summary: "Book a room on the base.",
    href: "/bookings/spaces",
    moduleId: "bookings",
    ownerSlug: "operations",
    ownerAssumed: true,
  },
  {
    id: "vehicles",
    name: "Vehicles",
    summary: "Request a vehicle from the fleet.",
    href: "/bookings/vehicles",
    moduleId: "bookings",
    ownerSlug: "operations",
    ownerAssumed: true,
  },
  {
    id: "gear",
    name: "Gear hire",
    summary: "Hire equipment from the catalogue.",
    href: "/bookings/equipment",
    moduleId: "bookings",
    ownerSlug: "media",
    ownerAssumed: true,
  },
  {
    id: "brand-kit",
    name: "Brand kit",
    summary: "Palette, logos and voice for emails and event pages.",
    href: "/brand-kit",
    moduleId: "brand-kit",
    ownerSlug: "media",
    ownerAssumed: true,
  },
  {
    id: "communications",
    name: "Communications",
    summary: "Announcements and partner updates.",
    href: "/communications",
    moduleId: "communications",
    ownerSlug: "donors-dev",
    ownerAssumed: true,
  },
  {
    id: "contacts",
    name: "Contacts",
    summary: "The contact directory.",
    href: "/contacts",
    moduleId: "contacts",
    ownerSlug: null,
    ownerAssumed: false,
  },
  {
    id: "evangelism",
    name: "Evangelism",
    summary: "Staff share testimonies. Shown only while the module is visible to you.",
    href: "/evangelism",
    moduleId: "evangelism",
    ownerSlug: null,
    ownerAssumed: false,
  },
];

export const ROCKS: Rock[] = [
  {
    id: "pw-rota",
    departmentSlug: "prayer-worship",
    title: "Agree the term's worship lead rota",
    owner: "Jolizna Roestorf",
    status: "off_track",
    dueOn: "2026-11-01",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "pw-coverage",
    departmentSlug: "prayer-worship",
    title: "Confirm night-band coverage for the week",
    owner: "Jack Kilman",
    status: "on_track",
    dueOn: "2026-11-20",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "pw-advent",
    departmentSlug: "prayer-worship",
    title: "Write the Advent set plan",
    owner: "Davis Crouch",
    status: "on_track",
    dueOn: "2026-12-15",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "pw-notes",
    departmentSlug: "prayer-worship",
    title: "Close the October evaluation notes",
    owner: "Davis Crouch",
    status: "done",
    dueOn: "2026-11-05",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "mc-rota",
    departmentSlug: "missio-church",
    title: "Confirm the December preaching rota",
    owner: "Dwayne Roberts",
    status: "on_track",
    dueOn: "2026-11-18",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "lt-donors",
    departmentSlug: "leadership-team",
    title: "Name a lead for Donors & Dev",
    owner: "Allyson Roestorf",
    status: "on_track",
    dueOn: "2026-11-12",
    quarter: CURRENT_QUARTER,
  },
  {
    id: "tr-dates",
    departmentSlug: "training",
    title: "Publish the 2027 school dates",
    owner: "Allyson Roestorf",
    status: "on_track",
    dueOn: "2026-11-15",
    quarter: CURRENT_QUARTER,
  },
];

export const BUDGETS: DepartmentBudget[] = [
  {
    departmentSlug: "prayer-worship",
    project: { name: "Worship & Prayer", budgetRand: 186_000, spentRand: 74_200 },
  },
  {
    departmentSlug: "missio-church",
    project: { name: "Missio", budgetRand: 210_000, spentRand: 64_000 },
  },
  {
    departmentSlug: "training",
    project: { name: "Training", budgetRand: 540_000, spentRand: 310_000 },
  },
  {
    departmentSlug: "operations",
    project: { name: "Motor Vehicles — Fleet", budgetRand: 420_000, spentRand: 265_000 },
  },
  {
    departmentSlug: "events",
    project: { name: "Events", budgetRand: 150_000, spentRand: 88_000 },
  },
  {
    departmentSlug: "media",
    project: { name: "Media", budgetRand: 96_000, spentRand: 41_000 },
  },
];

export const OKR_CHECK_INS: OkrCheckIn[] = [
  {
    id: "pw-open",
    departmentSlug: "prayer-worship",
    cycleName: OKR_CYCLE.name,
    dueOn: "2026-11-30",
    completed: false,
    href: OKR_CYCLE.href,
  },
  {
    id: "pw-closed",
    departmentSlug: "prayer-worship",
    cycleName: OKR_CYCLE.name,
    dueOn: "2026-10-31",
    completed: true,
    href: OKR_CYCLE.href,
  },
  {
    id: "mc-open",
    departmentSlug: "missio-church",
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

/**
 * Stand-in for the signed-in person until `GET /api/me/home` exists.
 * Jack leads Prayer & Worship and serves on Missio Church.
 * Super admin so the catalogue screenshot can show every card the
 * module rules allow; selectors are tested with narrower viewers too.
 */
export const MOCK_VIEWER: DepartmentViewer = {
  name: "Jack Kilman",
  roles: ["super_admin"],
  permittedModules: [],
  memberships: [
    { departmentSlug: "prayer-worship", capacity: "leader" },
    { departmentSlug: "missio-church", capacity: "member" },
  ],
  usedServiceIds: ["prayer-room", "vehicles", "gear"],
};
