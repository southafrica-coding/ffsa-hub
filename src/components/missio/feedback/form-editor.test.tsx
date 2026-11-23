/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "../house-churches/test-render";
import { MissioViewerProvider } from "../viewer";
import type { MissioMe } from "../types-shim";
import { MissioFeedbackFormEditor, type MissioWeeklyFormView } from "./form-editor";

// fetch is a stub: nothing reaches a database.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const me = (roles: string[]) => ({ currentOrg: "missio", orgs: [], rolesByOrg: { missio: roles } }) as unknown as MissioMe;

const form: MissioWeeklyFormView = {
  id: "weekly-1",
  name: "Missio weekly feedback",
  slug: "missio-weekly-feedback",
  is_active: true,
  records_attendance: false,
  label_id: null,
  access_mode: "token",
  kind: "missio_weekly_feedback",
  schema: {
    version: 1,
    branding: { logoUrl: null, accentColor: null },
    thankYou: { heading: "Thanks", message: "Sent." },
    steps: [{ id: "s1", title: "This week", fields: [{ id: "f1", type: "text", label: "How was it?", key: "", required: false }] }],
  } as MissioWeeklyFormView["schema"],
};

describe("Missio feedback form editor", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    vi.unstubAllGlobals();
  });
  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("is pastors only", () => {
    const host = mount(
      <MissioViewerProvider me={me(["coach"])}>
        <MissioFeedbackFormEditor pastor={false} form={null} />
      </MissioViewerProvider>
    );
    expect(host.querySelector("[data-testid=missio-feedback-form-denied]")?.textContent).toContain("Pastors only");
    expect(host.querySelector("[data-testid=form-view]")).toBeNull();
  });

  it("says so honestly when the form isn't there or is off", () => {
    const host = mount(
      <MissioViewerProvider me={me(["pastor"])}>
        <MissioFeedbackFormEditor pastor form={null} />
      </MissioViewerProvider>
    );
    expect(host.querySelector("[data-testid=missio-feedback-form-closed]")?.textContent).toContain("isn’t open yet");
  });

  it("edits questions only: no publish, no access mode, no /f link, and saves just name and schema", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ form: {} }), { status: 200 });
      })
    );
    const host = mount(
      <MissioViewerProvider me={me(["pastor"])}>
        <MissioFeedbackFormEditor pastor form={form} />
      </MissioViewerProvider>
    );
    const view = host.querySelector("[data-testid=form-view]") as HTMLElement;
    expect(view).toBeTruthy();
    expect(view.textContent).toContain("Missio · weekly feedback form");
    expect(view.textContent).not.toContain("Unpublish");
    expect(view.textContent).not.toContain("Save & publish");
    expect(view.querySelector("[aria-label='Who can fill it in']")).toBeNull();
    expect(view.textContent).not.toContain("/f/missio-weekly-feedback");
    expect(view.querySelector("a[href='/forms']")).toBeNull();
    expect(view.querySelector("a[href='/missio/house-churches/feedback']")).toBeTruthy();

    const save = [...view.querySelectorAll("button")].find((b) => b.textContent === "Save") as HTMLButtonElement;
    await act(async () => {
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/forms/weekly-1");
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(["name", "schema"]);
  });

  it("shows the one public link with Copy public link and Send on WhatsApp, and no personal-link wording", () => {
    const host = mount(
      <MissioViewerProvider me={me(["pastor"])}>
        <MissioFeedbackFormEditor pastor form={form} />
      </MissioViewerProvider>
    );
    const block = host.querySelector("[data-testid=public-feedback-link]") as HTMLElement;
    expect(block).toBeTruthy();
    expect(block.querySelector("[data-testid=public-feedback-url]")?.textContent).toMatch(/\/f\/missio-weekly-feedback$/);
    expect(block.querySelector("[data-testid=public-feedback-copy]")?.textContent).toBe("Copy public link");
    expect(block.querySelector("[data-testid=public-feedback-whatsapp]")?.textContent).toBe("Send on WhatsApp");
    expect(host.textContent).toContain("choose their");
    expect(host.textContent).not.toMatch(/Personal link only|comes later|aren’t made yet|Copy the leader|house’s own link/);
    expect(host.textContent).toContain("Anyone with the link · picks a house church");
  });
});
