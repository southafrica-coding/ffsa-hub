// Accessibility, dark mode and copy checks for the Me document screens:
// every tappable has a role and a name in both colour schemes, and every
// English string is present and plain.

import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MeProvider } from "@/features/shell";
import { auditTappables } from "@/lib/a11y/testing";
import { apiFetch } from "@/lib/api-client";

import { apiRoutes, makeMe } from "../../../../test/fixtures";
import { profileFetch } from "../http";
import { CvScreen } from "../screens/CvScreen";
import { HouseholdMemberScreen } from "../screens/HouseholdMemberScreen";
import { HouseholdScreen } from "../screens/HouseholdScreen";
import { InsuranceScreen } from "../screens/InsuranceScreen";
import { LicenceScreen } from "../screens/LicenceScreen";
import { PassportScreen } from "../screens/PassportScreen";
import { meStrings } from "../strings";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("../http", () => ({ profileFetch: jest.fn(), UPLOAD_TIMEOUT_MS: 90_000 }));
jest.mock("../doc-capture", () => ({ takeDocPhoto: jest.fn(), chooseDocPhoto: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ relationship: "child" }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: () => {},
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/lib/supabase", () => {
  const tables: Record<string, unknown> = {
    users: {
      health_insurance_provider: "Bonitas",
      health_insurance_policy_number: "POL-1",
      health_insurance_expiry_date: "2020-01-01",
      marital_status: "married",
      household_linked_at: "2026-01-01",
      essence_statement: "Hello",
      job_description: "Sound",
    },
    user_insurance_policies: [
      { id: "p2", provider: "Bonitas", policy_number: "POL-1", expiry_date: "2020-01-01", no_expiry: false, recorded_at: "2026-02-01T00:00:00Z" },
      { id: "p1", provider: "Bonitas", policy_number: "POL-1", expiry_date: "2019-01-01", no_expiry: false, recorded_at: "2026-01-01T00:00:00Z" },
    ],
    staff_cv_entries: [{ id: "e1", category: "skill", title: "Live sound", added_by_role: "self" }],
  };
  return {
    supabase: {
      from: (t: string) => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          maybeSingle: () => chain,
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: tables[t] ?? null, error: null }).then(res),
        };
        return chain;
      },
    },
  };
});
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => ({
  ...jest.requireActual("@/theme/use-theme"),
  useTheme: () => jest.requireActual("@/theme/use-theme").themeFor(mockScheme),
}));

const SIGNED = "https://test-project.supabase.co/storage/v1/object/sign/vehicle-inspections/x.jpg?token=t";
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MeProvider>{ui}</MeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  (apiFetch as jest.Mock).mockImplementation(apiRoutes({ "/api/me": makeMe() }));
  (profileFetch as unknown as jest.Mock).mockImplementation(
    apiRoutes({
      "/api/profile/licence": { licence: { drivers_licence_number: "DL", licence_expiry_date: "2020-01-01", has_file: true, signed_url: SIGNED } },
      "/api/profile/passport-photo": { passport: { has_file: true, file_name: "passport.jpg", signed_url: SIGNED } },
      "/api/profile/household": { members: [{ id: "m1", relationship: "child", full_name: "Sam" }] },
    }),
  );
});

const cases: [string, () => ReactElement, string][] = [
  ["licence", () => <LicenceScreen />, "Save licence details"],
  ["passport", () => <PassportScreen />, "View"],
  ["insurance", () => <InsuranceScreen />, "Update current policy"],
  ["household", () => <HouseholdScreen />, "Add child"],
  ["household member", () => <HouseholdMemberScreen />, "Add member"],
  ["staff CV", () => <CvScreen />, "Save"],
];

describe.each(["light", "dark"] as const)("%s mode", (scheme) => {
  it.each(cases)("%s: every tappable has a role and a name", async (_name, ui, ready) => {
    mockScheme = scheme;
    await show(ui());
    expect(await screen.findByRole("button", { name: ready })).toBeTruthy();
    expect(auditTappables(screen.container as never)).toEqual([]);
  });
});

it("insurance shows at most ONE yellow band", async () => {
  mockScheme = "light";
  await show(<InsuranceScreen />);
  expect(await screen.findAllByTestId("insurance-needs-you")).toHaveLength(1);
});

describe("strings", () => {
  const all: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") all.push(v);
    else if (typeof v === "function") {
      const out = (v as (...a: unknown[]) => unknown)("X", 2);
      if (typeof out === "string") all.push(out);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(meStrings.docs);
  walk(meStrings.rows);

  it("are all present", () => {
    expect(all.length).toBeGreaterThan(100);
    for (const s of all) expect(s.trim().length).toBeGreaterThan(0);
  });

  it("are plain: no jargon or placeholders", () => {
    for (const s of all) expect(s).not.toMatch(/TODO|lorem|signed URL|RLS|bucket|API|null|undefined/i);
  });

  it("say who can see the licence and passport, without broadening it", () => {
    expect(meStrings.docs.privacyVehicles).toMatch(/Only you and the vehicles team/);
  });
});
