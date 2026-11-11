import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  roles: ["admin"] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
  }),
}));

vi.mock("@/lib/sidebar-access", () => ({
  getSidebarAccess: async () => ({ userRoles: state.roles }),
}));

import DesignSystemPage, { metadata } from "./page";

describe("Design system gallery title", () => {
  beforeEach(() => {
    state.user = { id: "admin-1" };
    state.roles = ["admin"];
  });

  it("matches the page metadata, Design system", async () => {
    expect(metadata.title).toBe("Design system");
    const html = renderToStaticMarkup(await DesignSystemPage());
    expect(html).toContain('<h1 class="hero-title mt-2">Design system</h1>');
    expect(html).not.toContain('<h1 class="hero-title mt-2">Prayer room</h1>');
  });

  it("keeps the prayer room sample in the nav label's casing", async () => {
    const html = renderToStaticMarkup(await DesignSystemPage());
    expect(html).toContain("Prayer room");
    expect(html).not.toContain("Prayer Room");
  });
});
