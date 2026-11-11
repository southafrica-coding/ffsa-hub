import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetCaches = vi.hoisted(() => {
  const clears: Array<() => void> = [];
  return {
    add(clear: () => void) {
      clears.push(clear);
    },
    reset() {
      for (const clear of clears) clear();
    },
  };
});

/**
 * Vitest loads the client React, whose cache() does not remember a value.
 * This stands in for the server cache: one request, one result per function.
 */
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache<T extends (...args: never[]) => unknown>(fn: T): T {
      let zero: { value: ReturnType<T> } | undefined;
      let keyed = new WeakMap<object, ReturnType<T>>();
      resetCaches.add(() => {
        zero = undefined;
        keyed = new WeakMap();
      });
      return ((...args: never[]) => {
        if (args.length === 0) {
          if (!zero) zero = { value: fn() as ReturnType<T> };
          return zero.value;
        }
        const key = args[0];
        if (key && typeof key === "object") {
          const hit = keyed.get(key);
          if (hit !== undefined) return hit;
          const value = fn(...args) as ReturnType<T>;
          keyed.set(key, value);
          return value;
        }
        return fn(...args);
      }) as T;
    },
  };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/home",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

vi.mock("@/components/hub-shell", () => ({
  HubShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const counts = { getUser: 0, isActive: 0 };
const supabase = {
  auth: {
    getUser: async () => {
      counts.getUser += 1;
      return { data: { user: { id: "user-1", email: "ada@example.com" } }, error: null };
    },
  },
  from(table: string) {
    return {
      select(columns: string) {
        const builder = {
          eq() {
            return builder;
          },
          in() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle: async () => {
            if (table === "users" && columns === "is_active") counts.isActive += 1;
            if (table === "users" && columns === "is_active") return { data: { is_active: true }, error: null };
            if (table === "users") {
              return { data: { first_name: "Ada", last_name: "Lovelace", preferred_name: null }, error: null };
            }
            return { data: null, error: null };
          },
          then(resolve: (value: { data: unknown[]; error: null }) => void, reject?: (reason: unknown) => void) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  },
  rpc: async () => ({ data: false, error: null }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));

const summary = {
  slug: "media",
  name: "Media",
  cluster: "inward" as const,
  parentSlug: null,
  parentName: null,
  purpose: null,
  memberCount: 1,
  active: true,
  budgetOnly: false,
  viewerMembership: "member" as const,
  access: {
    canSeeDepartmentDetail: true,
    canSeeBudget: false,
    canEditBudget: false,
    canEditRocks: false,
    canSeePeopleEmails: false,
  },
};

vi.mock("@/lib/departments", () => ({
  loadDepartmentsIndexForViewer: async () => ({ kind: "ok", data: [summary] }),
  loadHomeForViewer: async () => ({
    kind: "ok",
    data: { departments: [summary], services: [], rocksDue: [], okrCheckInsDue: [], viewerMemberships: [] },
  }),
  loadServicesForViewer: async () => ({ kind: "ok", data: [] }),
  loadDepartmentHomeForViewer: async () => ({
    kind: "ok",
    data: {
      department: summary,
      access: summary.access,
      viewerMemberships: [],
      people: [],
      okrs: null,
      rocks: [],
      budget: null,
      servicesRun: [],
      subMinistries: [],
    },
  }),
}));

vi.mock("@/app/(admin)/departments/[slug]/department-view", () => ({
  DepartmentView: () => <p>Department</p>,
}));

import AdminLayout from "@/app/(admin)/layout";
import HomePage from "@/app/(admin)/home/page";
import ServicesPage from "@/app/(admin)/services/page";
import DepartmentsLayout from "@/app/(admin)/departments/layout";
import DepartmentsPage from "@/app/(admin)/departments/page";
import DepartmentPage from "@/app/(admin)/departments/[slug]/page";

async function renderRoute(page: Promise<React.ReactNode> | React.ReactNode, departments = false) {
  counts.getUser = 0;
  counts.isActive = 0;
  const child = await page;
  const body = departments ? await DepartmentsLayout({ children: child }) : child;
  renderToStaticMarkup(await AdminLayout({ children: body }));
  return { ...counts };
}

/**
 * On 3d41479b, with this same server-style cache, each route below was
 * getUser 3 and is_active 3: the cached viewer, then the sidebar's own
 * getUser and is_active, then initials' getUser and the schools access
 * check's is_active.
 */
describe("viewer reads for one request", () => {
  beforeEach(() => {
    counts.getUser = 0;
    counts.isActive = 0;
    resetCaches.reset();
  });

  it("counts getUser and is_active on /home", async () => {
    await expect(renderRoute(HomePage())).resolves.toEqual({ getUser: 1, isActive: 1 });
  });

  it("counts getUser and is_active on /services", async () => {
    await expect(renderRoute(ServicesPage())).resolves.toEqual({ getUser: 1, isActive: 1 });
  });

  it("counts getUser and is_active on /departments", async () => {
    await expect(renderRoute(DepartmentsPage(), true)).resolves.toEqual({ getUser: 1, isActive: 1 });
  });

  it("counts getUser and is_active on /departments/[slug]", async () => {
    const page = DepartmentPage({
      params: Promise.resolve({ slug: "media" }),
      searchParams: Promise.resolve({}),
    });
    await expect(renderRoute(page, true)).resolves.toEqual({ getUser: 1, isActive: 1 });
  });
});
