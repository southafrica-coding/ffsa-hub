import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ServerRefusal } from "@/features/bookings/http";
import { MeProvider } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { apiRoutes, makeMe } from "../../../../test/fixtures";
import { chooseDocPhoto, takeDocPhoto } from "../doc-capture";
import { profileFetch } from "../http";
import { CvScreen } from "../screens/CvScreen";
import { HouseholdMemberScreen } from "../screens/HouseholdMemberScreen";
import { HouseholdScreen } from "../screens/HouseholdScreen";
import { InsuranceScreen } from "../screens/InsuranceScreen";
import { LicenceScreen } from "../screens/LicenceScreen";
import { PassportScreen } from "../screens/PassportScreen";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("../http", () => ({ profileFetch: jest.fn(), UPLOAD_TIMEOUT_MS: 90_000 }));
jest.mock("../doc-capture", () => ({ takeDocPhoto: jest.fn(), chooseDocPhoto: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn() };
const mockParams: { current: Record<string, string> } = { current: {} };
const mockNav = { setOptions: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => mockNav,
  useFocusEffect: () => {},
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));

// Supabase stand-in answering by table (own-row reads under RLS).
const mockTables: { current: Record<string, { data: unknown; error: unknown }> } = { current: {} };
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const answer = () => mockTables.current[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: () => chain,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej),
      };
      return chain;
    },
  },
}));

const pf = profileFetch as unknown as jest.Mock;
const me = apiFetch as unknown as jest.Mock;
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;
const take = takeDocPhoto as jest.Mock;
const choose = chooseDocPhoto as jest.Mock;
const alertSpy = jest.spyOn(Alert, "alert");

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: ReactNode) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <MeProvider>{ui}</MeProvider>
  </SafeAreaProvider>
);

/** Confirm the next Alert by pressing its destructive button. */
function confirmNextAlert() {
  alertSpy.mockImplementationOnce((_t, _m, buttons) => {
    buttons?.find((b) => b.style === "destructive")?.onPress?.();
  });
}

const SIGNED = "https://test-project.supabase.co/storage/v1/object/sign/vehicle-inspections/user-licenses/u1/1.jpg?token=t";
const FORBIDDEN = new ApiError("forbidden", "You don't have access to this.", 403);
const OFFLINE = new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again.");

beforeEach(() => {
  pf.mockReset();
  me.mockReset();
  me.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
  take.mockReset();
  choose.mockReset();
  openBrowser.mockClear();
  alertSpy.mockClear();
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockNav.setOptions.mockClear();
  mockParams.current = {};
  mockTables.current = {};
});

// ── Licence ────────────────────────────────────────────────────────────────

const LICENCE = {
  licence: {
    drivers_licence_number: "DL-555",
    licence_country: "ZA",
    licence_code: "B",
    licence_expiry_date: "2030-05-01",
    licence_file_name: "licence.jpg",
    has_file: true,
    signed_url: SIGNED,
    base_driving_test_status: "passed",
    base_driving_test_passed_at: "2026-02-01",
  },
};

describe("Licence", () => {
  it("loading: skeleton while the API answers", async () => {
    pf.mockImplementation(() => new Promise(() => {}));
    await render(wrap(<LicenceScreen />));
    expect(screen.getByLabelText("Loading your licence")).toBeTruthy();
  });

  it("empty: nothing on file yet offers the camera", async () => {
    pf.mockImplementation(apiRoutes({ "/api/profile/licence": { licence: { has_file: false } } }));
    await render(wrap(<LicenceScreen />));
    expect(await screen.findByLabelText("Photo of your licence: Nothing uploaded yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take a photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    expect(screen.getByText(/Only you and the vehicles team can open this/)).toBeTruthy();
  });

  it("success: details, test result, and View opens the signed link in the in-app browser", async () => {
    pf.mockImplementation(apiRoutes({ "/api/profile/licence": LICENCE }));
    await render(wrap(<LicenceScreen />));
    expect(await screen.findByDisplayValue("DL-555")).toBeTruthy();
    expect(screen.getByLabelText("Issuing country: South Africa")).toBeTruthy();
    expect(screen.getByLabelText("Base-vehicle driving test: Passed. Passed on 1 Feb 2026")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "View" }));
    expect(openBrowser).toHaveBeenCalledWith(SIGNED, expect.any(Object));
  });

  it("refuses to open a link that isn't our signed storage", async () => {
    pf.mockImplementation(apiRoutes({ "/api/profile/licence": { licence: { ...LICENCE.licence, signed_url: "https://evil.example/x" } } }));
    await render(wrap(<LicenceScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "View" }));
    expect(openBrowser).not.toHaveBeenCalled();
    expect(screen.getByText("Couldn't open the file. Try again in a moment.")).toBeTruthy();
  });

  it("expired licence shows a red warning (not the yellow band)", async () => {
    pf.mockImplementation(apiRoutes({ "/api/profile/licence": { licence: { ...LICENCE.licence, licence_expiry_date: "2020-01-01" } } }));
    await render(wrap(<LicenceScreen />));
    expect(await screen.findByText(/This licence expired on 1 Jan 2020/)).toBeTruthy();
  });

  it("validates, then saves with PUT and shows the server's own refusal", async () => {
    const puts: unknown[] = [];
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/licence": (init?: { method?: string; body?: unknown }) => {
          if (init?.method === "PUT") {
            puts.push(init.body);
            if (puts.length === 1) return new ServerRefusal("Please enter the licence expiry date.", 400, {});
            return { ok: true };
          }
          return LICENCE;
        },
      }),
    );
    await render(wrap(<LicenceScreen />));
    const number = await screen.findByLabelText("Licence number");
    await fireEvent.changeText(number, "");
    await fireEvent.press(screen.getByRole("button", { name: "Save licence details" }));
    expect(screen.getByText("Enter your licence number.")).toBeTruthy();
    expect(puts).toHaveLength(0);

    await fireEvent.changeText(number, "DL-777");
    await fireEvent.press(screen.getByRole("button", { name: "Save licence details" }));
    expect(await screen.findByText("Please enter the licence expiry date.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save licence details" }));
    expect(await screen.findByRole("button", { name: "Saved." })).toBeTruthy();
    expect(puts[1]).toEqual({ drivers_licence_number: "DL-777", licence_country: "ZA", licence_code: "B", licence_expiry_date: "2030-05-01" });
  });

  it("photo: uploads, then deletes the local copy (success and failure)", async () => {
    const cleanup = jest.fn();
    take.mockResolvedValue({ uri: "file:///cache/x.jpg", name: "licence.jpg", type: "image/jpeg", cleanup });
    let fail = true;
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/licence": (init?: { method?: string }) => {
          if (init?.method === "POST") return fail ? OFFLINE : { ok: true, file_name: "licence.jpg", signed_url: SIGNED };
          return { licence: { has_file: false } };
        },
      }),
    );
    await render(wrap(<LicenceScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Take a photo" }));
    expect(await screen.findByText(OFFLINE.message)).toBeTruthy();
    expect(cleanup).toHaveBeenCalledTimes(1);

    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Take a photo" }));
    expect(await screen.findByLabelText("Photo of your licence: On file")).toBeTruthy();
    expect(cleanup).toHaveBeenCalledTimes(2);
    const post = pf.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[1].body).toBeInstanceOf(FormData);
  });

  it("cancelling the camera sends nothing", async () => {
    take.mockResolvedValue(null);
    pf.mockImplementation(apiRoutes({ "/api/profile/licence": { licence: { has_file: false } } }));
    await render(wrap(<LicenceScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Take a photo" }));
    expect(pf.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
  });

  it("error: plain message and retry", async () => {
    pf.mockRejectedValueOnce(OFFLINE);
    pf.mockImplementation(apiRoutes({ "/api/profile/licence": LICENCE }));
    await render(wrap(<LicenceScreen />));
    expect(await screen.findByText("Couldn't load your licence")).toBeTruthy();
    expect(screen.getByText(OFFLINE.message)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByDisplayValue("DL-555")).toBeTruthy();
  });

  it("permission denied: says so", async () => {
    pf.mockRejectedValue(FORBIDDEN);
    await render(wrap(<LicenceScreen />));
    expect(await screen.findByText("Not available on your account")).toBeTruthy();
  });
});

// ── Passport ───────────────────────────────────────────────────────────────

describe("Passport photo", () => {
  it("loading", async () => {
    pf.mockImplementation(() => new Promise(() => {}));
    await render(wrap(<PassportScreen />));
    expect(screen.getByLabelText("Loading your passport photo")).toBeTruthy();
  });

  it("empty → choose a photo → on file", async () => {
    const cleanup = jest.fn();
    choose.mockResolvedValue({ uri: "file:///cache/p.jpg", name: "passport.jpg", type: "image/jpeg", cleanup });
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/passport-photo": (init?: { method?: string }) =>
          init?.method === "POST" ? { ok: true, file_name: "passport.jpg", signed_url: SIGNED } : { passport: { has_file: false } },
      }),
    );
    await render(wrap(<PassportScreen />));
    expect(await screen.findByLabelText("Passport photo page: Nothing uploaded yet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Choose a photo" }));
    expect(await screen.findByRole("button", { name: "View" })).toBeTruthy();
    expect(cleanup).toHaveBeenCalled();
  });

  it("success: remove asks first, then deletes", async () => {
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/passport-photo": (init?: { method?: string }) =>
          init?.method === "DELETE"
            ? { ok: true }
            : { passport: { has_file: true, file_name: "passport.jpg", uploaded_at: "2026-10-01T10:00:00Z", signed_url: SIGNED } },
      }),
    );
    await render(wrap(<PassportScreen />));
    expect(await screen.findByLabelText("Passport photo page: On file. Uploaded 1 Oct 2026")).toBeTruthy();
    confirmNextAlert();
    await fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByLabelText("Passport photo page: Nothing uploaded yet")).toBeTruthy();
    expect(pf).toHaveBeenCalledWith("/api/profile/passport-photo", { method: "DELETE" });
  });

  it("a PDF uploaded on the website says so", async () => {
    pf.mockImplementation(apiRoutes({ "/api/profile/passport-photo": { passport: { has_file: true, file_name: "scan.pdf", signed_url: SIGNED } } }));
    await render(wrap(<PassportScreen />));
    expect(await screen.findByText(/A PDF is on file/)).toBeTruthy();
  });

  it("error + retry, and forbidden", async () => {
    pf.mockRejectedValueOnce(OFFLINE);
    pf.mockImplementation(apiRoutes({ "/api/profile/passport-photo": { passport: { has_file: false } } }));
    await render(wrap(<PassportScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Passport photo page: Nothing uploaded yet")).toBeTruthy();
  });

  it("forbidden", async () => {
    pf.mockRejectedValue(FORBIDDEN);
    await render(wrap(<PassportScreen />));
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
  });
});

// ── Insurance ──────────────────────────────────────────────────────────────

const ROW = {
  health_insurance_provider: "Bonitas",
  health_insurance_policy_number: "POL-1",
  health_insurance_expiry_date: "2031-01-01",
  health_insurance_no_expiry: false,
  health_insurance_confirmed_at: null,
  next_health_insurance_provider: null,
};

function insuranceTables(row: Record<string, unknown> = ROW, history: unknown[] = []) {
  mockTables.current = {
    users: { data: row, error: null },
    user_insurance_policies: { data: history, error: null },
    list_options: { data: [], error: null },
  };
}

describe("Health insurance", () => {
  it("loading", async () => {
    mockTables.current = { users: new Promise(() => {}) as never };
    await render(wrap(<InsuranceScreen />));
    expect(screen.getByLabelText("Loading your health insurance")).toBeTruthy();
  });

  it("empty: no policy on file", async () => {
    insuranceTables({}, []);
    await render(wrap(<InsuranceScreen />));
    expect(await screen.findByText("No policy on file yet.")).toBeTruthy();
    expect(screen.getByText("No policies on record yet.")).toBeTruthy();
    expect(screen.queryByTestId("insurance-needs-you")).toBeNull();
  });

  it("success: current policy, no band when valid", async () => {
    insuranceTables();
    await render(wrap(<InsuranceScreen />));
    expect(await screen.findByLabelText("Provider: Bonitas")).toBeTruthy();
    expect(screen.getByLabelText("Policy number: POL-1")).toBeTruthy();
    expect(screen.getByLabelText("Expiry date: Valid until 1 Jan 2031")).toBeTruthy();
    expect(screen.queryByTestId("insurance-needs-you")).toBeNull();
  });

  it("expired with no next policy: one yellow band", async () => {
    insuranceTables({ ...ROW, health_insurance_expiry_date: "2020-01-01" });
    await render(wrap(<InsuranceScreen />));
    expect(await screen.findByTestId("insurance-needs-you")).toBeTruthy();
    expect(screen.getByText(/Your health insurance has expired/)).toBeTruthy();
  });

  it("open-ended scheme due for its yearly check: confirm from the band", async () => {
    insuranceTables({ ...ROW, health_insurance_expiry_date: null, health_insurance_no_expiry: true, health_insurance_confirmed_at: null });
    pf.mockResolvedValue({ success: true });
    await render(wrap(<InsuranceScreen />));
    expect(await screen.findByText("Please confirm your medical scheme is still active.")).toBeTruthy();
    expect(screen.getByText(/nothing for a next policy to take over from/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Yes, it's still active" }));
    expect(pf).toHaveBeenCalledWith("/api/profile/insurance-confirm", { method: "POST" });
  });

  it("update current policy: validates, sends PUT /api/profile/update", async () => {
    insuranceTables();
    pf.mockResolvedValue({ success: true });
    await render(wrap(<InsuranceScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Update current policy" }));
    await fireEvent.changeText(screen.getByLabelText("Policy number"), "POL-2");
    await fireEvent.press(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() =>
      expect(pf).toHaveBeenCalledWith("/api/profile/update", {
        method: "PUT",
        body: {
          health_insurance_provider: "Bonitas",
          health_insurance_policy_number: "POL-2",
          health_insurance_expiry_date: "2031-01-01",
          health_insurance_no_expiry: false,
        },
      }),
    );
  });

  it("update shows the server's refusal word for word", async () => {
    insuranceTables();
    pf.mockRejectedValue(new ServerRefusal("Please select a valid health insurance provider.", 400, {}));
    await render(wrap(<InsuranceScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Update current policy" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save policy" }));
    expect(await screen.findByText("Please select a valid health insurance provider.")).toBeTruthy();
  });

  it("history: the current row is protected, a duplicate can be removed", async () => {
    insuranceTables(ROW, [
      { id: "p2", provider: "Bonitas", policy_number: "POL-1", expiry_date: "2031-01-01", no_expiry: false, recorded_at: "2026-02-01T00:00:00Z" },
      { id: "p1", provider: "Bonitas", policy_number: "POL-1", expiry_date: "2030-01-01", no_expiry: false, recorded_at: "2026-01-01T00:00:00Z" },
    ]);
    pf.mockResolvedValue({ ok: true });
    await render(wrap(<InsuranceScreen />));
    expect(await screen.findByLabelText("Bonitas, POL-1, 1 Jan 2031, Current")).toBeTruthy();
    const remove = screen.getAllByRole("button", { name: /Remove duplicate/ });
    expect(remove).toHaveLength(1);
    confirmNextAlert();
    await fireEvent.press(remove[0]);
    await waitFor(() => expect(pf).toHaveBeenCalledWith("/api/profile/insurance-policies/p1", { method: "DELETE" }));
  });

  it("error + retry", async () => {
    mockTables.current = { users: { data: null, error: { message: "relation does not exist" } } };
    await render(wrap(<InsuranceScreen />));
    expect(await screen.findByText("Couldn't load your health insurance")).toBeTruthy();
    // a raw database message is never shown
    expect(screen.queryByText(/relation does not exist/)).toBeNull();
    insuranceTables();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Provider: Bonitas")).toBeTruthy();
  });

  it("forbidden on a write", async () => {
    insuranceTables({ ...ROW, health_insurance_no_expiry: true, health_insurance_expiry_date: null });
    pf.mockRejectedValue(FORBIDDEN);
    await render(wrap(<InsuranceScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Yes, it's still active" }));
    expect(await screen.findByText("You don't have access to this.")).toBeTruthy();
  });
});

// ── Household ──────────────────────────────────────────────────────────────

const SAM = { id: "m1", relationship: "child", full_name: "Sam Smit", passport_number: "A1" };

describe("Household", () => {
  it("loading", async () => {
    pf.mockImplementation(() => new Promise(() => {}));
    await render(wrap(<HouseholdScreen />));
    expect(screen.getByLabelText("Loading your household")).toBeTruthy();
  });

  it("empty, single: offers children only", async () => {
    pf.mockImplementation(apiRoutes({ "/api/profile/household": { members: [] } }));
    mockTables.current = { users: { data: { marital_status: "single" }, error: null } };
    await render(wrap(<HouseholdScreen />));
    expect(await screen.findByTestId("household-empty")).toBeTruthy();
    expect(screen.getByText("Add your children so we have their details on record.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add spouse" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Add child" }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/me/household-member", params: { relationship: "child" } });
  });

  it("success, married + linked: members, add spouse, leave the shared record", async () => {
    pf.mockImplementation(
      apiRoutes({ "/api/profile/household": { members: [SAM] }, "/api/profile/household/link": { success: true } }),
    );
    mockTables.current = { users: { data: { marital_status: "married", household_linked_at: "2026-01-01T00:00:00Z" }, error: null } };
    await render(wrap(<HouseholdScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Sam Smit" }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/me/household-member", params: { id: "m1" } });
    expect(screen.getByRole("button", { name: "Add spouse" })).toBeTruthy();
    expect(screen.getByText("Shared with your spouse's account")).toBeTruthy();
    confirmNextAlert();
    await fireEvent.press(screen.getByRole("button", { name: "This isn't my family" }));
    await waitFor(() => expect(pf).toHaveBeenCalledWith("/api/profile/household/link", { method: "DELETE" }));
  });

  it("error + retry", async () => {
    pf.mockRejectedValueOnce(OFFLINE);
    pf.mockImplementation(apiRoutes({ "/api/profile/household": { members: [SAM] } }));
    await render(wrap(<HouseholdScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Sam Smit" })).toBeTruthy();
  });

  it("forbidden", async () => {
    pf.mockRejectedValue(FORBIDDEN);
    await render(wrap(<HouseholdScreen />));
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
  });
});

describe("Household member", () => {
  it("add spouse: name + email only, validated, POST", async () => {
    mockParams.current = { relationship: "spouse" };
    const posts: unknown[] = [];
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/household": (init?: { method?: string; body?: unknown }) => {
          if (init?.method === "POST") {
            posts.push(init.body);
            return { member: { id: "m2", relationship: "spouse", full_name: "Jo Smit" } };
          }
          return { members: [] };
        },
      }),
    );
    await render(wrap(<HouseholdMemberScreen />));
    await fireEvent.press(await screen.findByRole("button", { name: "Add member" }));
    expect(screen.getByText("Enter your spouse's first name.")).toBeTruthy();
    expect(screen.queryByLabelText("Passport number")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("First name"), "Jo");
    await fireEvent.changeText(screen.getByLabelText("Last name"), "Smit");
    await fireEvent.changeText(screen.getByLabelText("Email"), "jo@example.org");
    await fireEvent.press(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(posts[0]).toMatchObject({ relationship: "spouse", full_name: "Jo Smit", email: "jo@example.org" });
    expect(mockNav.setOptions).toHaveBeenCalledWith({ title: "Add spouse" });
  });

  it("add child: 'same as mine' copies visa + insurance", async () => {
    mockParams.current = { relationship: "child" };
    mockTables.current = {
      users: {
        data: { is_international: true, visa_category: "90_day", health_insurance_provider: "Bonitas", health_insurance_policy_number: "POL-1" },
        error: null,
      },
    };
    pf.mockImplementation(apiRoutes({ "/api/profile/household": { members: [] } }));
    await render(wrap(<HouseholdMemberScreen />));
    await fireEvent(await screen.findByRole("switch", { name: "Visa and insurance same as mine" }), "valueChange", true);
    expect(screen.getByLabelText("Visa status: 90-Day Visa")).toBeTruthy();
    expect(screen.getByLabelText("Provider: Bonitas")).toBeTruthy();
    expect(screen.getByDisplayValue("POL-1")).toBeTruthy();
  });

  it("edit child: PUT, and remove asks first", async () => {
    mockParams.current = { id: "m1" };
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/household": { members: [SAM] },
        "/api/profile/household/m1": (init?: { method?: string }) => (init?.method === "PUT" ? { member: SAM } : { success: true }),
      }),
    );
    await render(wrap(<HouseholdMemberScreen />));
    expect(await screen.findByDisplayValue("Sam Smit")).toBeTruthy();
    expect(mockNav.setOptions).toHaveBeenCalledWith({ title: "Edit child" });
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(pf.mock.calls.some((c) => c[0] === "/api/profile/household/m1" && c[1]?.method === "PUT")).toBe(true));
    confirmNextAlert();
    await fireEvent.press(screen.getByRole("button", { name: "Remove from household" }));
    await waitFor(() => expect(pf).toHaveBeenCalledWith("/api/profile/household/m1", { method: "DELETE" }));
  });

  it("a member that's gone says so", async () => {
    mockParams.current = { id: "gone" };
    pf.mockImplementation(apiRoutes({ "/api/profile/household": { members: [SAM] } }));
    await render(wrap(<HouseholdMemberScreen />));
    expect(await screen.findByTestId("member-missing")).toBeTruthy();
  });

  it("save refused by the server (e.g. spouse when single) shows its words", async () => {
    mockParams.current = { relationship: "spouse" };
    const refusal = "Your marital status is set to single, so a spouse can't be added.";
    pf.mockImplementation(
      apiRoutes({
        "/api/profile/household": (init?: { method?: string }) =>
          init?.method === "POST" ? new ServerRefusal(refusal, 400, {}) : { members: [] },
      }),
    );
    await render(wrap(<HouseholdMemberScreen />));
    await fireEvent.changeText(await screen.findByLabelText("First name"), "Jo");
    await fireEvent.changeText(screen.getByLabelText("Last name"), "Smit");
    await fireEvent.changeText(screen.getByLabelText("Email"), "jo@example.org");
    await fireEvent.press(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText(refusal)).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

// ── Staff CV ───────────────────────────────────────────────────────────────

describe("About your role (staff CV)", () => {
  it("not staff: says it's for staff (UX gate only)", async () => {
    me.mockImplementation(apiRoutes({ "/api/me": makeMe({ roles: [{ name: "student", scopeType: null, scopeId: null }] }) }));
    await render(wrap(<CvScreen />));
    expect(await screen.findByTestId("not-staff")).toBeTruthy();
  });

  it("loading", async () => {
    mockTables.current = { users: new Promise(() => {}) as never };
    await render(wrap(<CvScreen />));
    expect(screen.getByLabelText("Loading your staff CV")).toBeTruthy();
  });

  it("empty: no job description, no entries", async () => {
    mockTables.current = { users: { data: {}, error: null }, staff_cv_entries: { data: [], error: null } };
    await render(wrap(<CvScreen />));
    expect(await screen.findByText("No job description yet. Your ministry leader sets it.")).toBeTruthy();
    expect(screen.getByText("Nothing added yet.")).toBeTruthy();
  });

  it("success: edit the essence statement (PATCH), entries read-only, web link for the rest", async () => {
    mockTables.current = {
      users: { data: { essence_statement: "Old", job_description: "Leads sound." }, error: null },
      staff_cv_entries: { data: [{ id: "e1", category: "skill", title: "Live sound", added_by_role: "leadership" }], error: null },
    };
    pf.mockResolvedValue({ success: true });
    await render(wrap(<CvScreen />));
    const field = await screen.findByDisplayValue("Old");
    expect(screen.getByLabelText("Job description: Leads sound.")).toBeTruthy();
    expect(screen.getByLabelText("Live sound. Added by leadership")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(field, "New statement");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(pf).toHaveBeenCalledWith("/api/profile/cv", { method: "PATCH", body: { essence_statement: "New statement" } }));
    await fireEvent.press(screen.getByRole("link", { name: /Add or change entries on the website/ }));
    expect(openBrowser.mock.calls.at(-1)?.[0]).toBe("https://hub.example.test/profile?tab=work");
  });

  it("error + retry", async () => {
    mockTables.current = { users: { data: null, error: { message: "x" } } };
    await render(wrap(<CvScreen />));
    expect(await screen.findByText("Couldn't load your staff CV")).toBeTruthy();
    mockTables.current = { users: { data: { essence_statement: "Back" }, error: null }, staff_cv_entries: { data: [], error: null } };
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByDisplayValue("Back")).toBeTruthy();
  });

  it("forbidden on save", async () => {
    mockTables.current = { users: { data: { essence_statement: "Old" }, error: null }, staff_cv_entries: { data: [], error: null } };
    pf.mockRejectedValue(FORBIDDEN);
    await render(wrap(<CvScreen />));
    await fireEvent.changeText(await screen.findByDisplayValue("Old"), "Changed");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You don't have access to this.")).toBeTruthy();
  });
});
