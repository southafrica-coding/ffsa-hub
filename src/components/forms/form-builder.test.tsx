/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormSchema } from "@/lib/forms/schema";
import { cleanup, render, setValue } from "@/components/missio/house-churches/test-render";
import { FormBuilder, type FormBuilderMeta } from "./form-builder";

// The builder only stores routes[] on the schema (PATCH /api/forms/[id]).
// fetch is a stub: nothing reaches a database, Slack or the route runner.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const schema = (): FormSchema => ({
  version: 1,
  branding: { logoUrl: null, accentColor: "#1e40af" },
  thankYou: { heading: "Thanks", message: "Sent." },
  steps: [
    {
      id: "s1",
      title: "How did it go?",
      fields: [
        { id: "f_email", type: "email", label: "Email", key: "email", required: true },
        { id: "f_leader", type: "text", label: "How are you doing as a leader?", key: "", required: true },
      ],
    },
  ],
});

const meta: FormBuilderMeta = {
  id: "form-1",
  name: "Weekly house feedback",
  slug: "weekly-house-feedback",
  is_active: false,
  records_attendance: false,
  label_id: null,
  access_mode: "logged_in",
};

function byText(host: HTMLElement, selector: string, text: string): HTMLElement {
  const el = [...host.querySelectorAll<HTMLElement>(selector)].find((e) => e.textContent?.trim() === text);
  if (!el) throw new Error(`No ${selector} with text "${text}"`);
  return el;
}
const byLabel = <T extends HTMLElement>(host: HTMLElement, label: string) => {
  const el = host.querySelector<T>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`No control labelled "${label}"`);
  return el;
};
function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function change(el: HTMLInputElement | HTMLSelectElement) {
  return (value: string) =>
    act(() => {
      setValue(el, value);
    });
}

describe("form builder: Route to", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    vi.unstubAllGlobals();
    refresh.mockReset();
  });

  function mount(props: Partial<Parameters<typeof FormBuilder>[0]> = {}) {
    const view = render(
      <FormBuilder form={meta} initialSchema={schema()} responsesHref="/forms/form-1/responses" {...props} />
    );
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  function stubFetch() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ form: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("saves a linear scale with a Slack route as routes[] on the schema", async () => {
    const fetchMock = stubFetch();
    const host = mount();

    click(byText(host, "button span", "How are you doing as a leader?").closest("button")!);
    expect(host.querySelector('[data-testid="question-view"]')).not.toBeNull();
    expect(host.textContent).toContain("Question 2 of 2 · Route to");

    change(byLabel<HTMLSelectElement>(host, "Question type"))("linear_scale");
    change(byLabel<HTMLInputElement>(host, "Low label"))("Struggling");
    change(byLabel<HTMLInputElement>(host, "High label"))("Doing great");

    click(byText(host, "button", "Add a route"));
    // New routes start as "one of …" → Slack, which needs answers and a who.
    change(byLabel<HTMLInputElement>(host, "Route 1 answers"))("1, 2");
    change(byLabel<HTMLInputElement>(host, "Route 1 target"))("house coach");
    expect(host.textContent).toContain("When the answer is one of 1 or 2");
    expect(host.textContent).toContain("Message someone in Slack · house coach");

    click(byText(host, "button", "Add another route"));
    change(byLabel<HTMLSelectElement>(host, "Route 2 rule"))("lt");
    change(byLabel<HTMLInputElement>(host, "Route 2 answer"))("3");
    change(byLabel<HTMLSelectElement>(host, "Route 2 action"))("care_board");
    change(byLabel<HTMLInputElement>(host, "Route 2 target"))("leader care");

    await act(async () => {
      byText(host, "button", "Save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/forms/form-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body));
    // Unchanged access mode is not re-sent; event-only settings are absent.
    expect(body).not.toHaveProperty("access_mode");
    expect(body).not.toHaveProperty("records_attendance");
    const leader = body.schema.steps[0].fields[1];
    expect(leader).toMatchObject({
      type: "linear_scale",
      min: 1,
      max: 5,
      minLabel: "Struggling",
      maxLabel: "Doing great",
      routes: [
        { action: "slack", target: "house coach", when: "in", whenValue: [1, 2] },
        { action: "care_board", target: "leader care", when: "lt", whenValue: 3 },
      ],
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("won't save a route that could never run", async () => {
    const fetchMock = stubFetch();
    const host = mount();
    click(byText(host, "button span", "How are you doing as a leader?").closest("button")!);
    click(byText(host, "button", "Add a route"));
    await act(async () => {
      byText(host, "button", "Save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("1 question needs fixing before this can be saved.");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("removing a route takes it out of what is saved", async () => {
    const fetchMock = stubFetch();
    const withRoute = schema();
    withRoute.steps[0].fields[1].routes = [{ action: "store", when: "always" }];
    const host = mount({ initialSchema: withRoute });
    expect(host.textContent).toContain("Keep with the response");
    click(byText(host, "button span", "How are you doing as a leader?").closest("button")!);
    click(byText(host, "button", "Remove route"));
    await act(async () => {
      byText(host, "button", "Save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.schema.steps[0].fields[1].routes).toEqual([]);
  });

  it("sends a changed access mode, and never offers personal links", async () => {
    const fetchMock = stubFetch();
    const host = mount();
    const select = byLabel<HTMLSelectElement>(host, "Who can fill it in");
    const token = [...select.options].find((o) => o.value === "token")!;
    expect(token.disabled).toBe(true);
    change(select)("public");
    await act(async () => {
      byText(host, "button", "Save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).access_mode).toBe(
      "public"
    );
  });

  it("the Missio weekly feedback form reads as one public link with a house picker, not a personal link", async () => {
    const fetchMock = stubFetch();
    const host = mount({
      form: { ...meta, slug: "missio-weekly-feedback", kind: "missio_weekly_feedback", access_mode: "token", is_active: true },
    });
    expect(host.textContent).toContain("Anyone with the link · picks a house church");
    expect(host.textContent).not.toContain("Personal link only");
    expect(host.textContent).not.toMatch(/comes later|Copy the leader/);
    // The share block shows the /f link and says who can fill it in.
    expect(host.textContent).toContain("/f/missio-weekly-feedback");
    expect(host.textContent).toContain("The first question asks which house church they are in");
    // No access-mode select to flip, and a save never sends access_mode.
    expect(host.querySelector("[aria-label='Who can fill it in']")).toBeNull();
    expect(host.querySelector("[data-testid=missio-public-access]")).toBeTruthy();
    await act(async () => {
      byText(host, "button", "Save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty("access_mode");
  });

  it("another form's token option no longer promises personal links later", () => {
    const host = mount();
    const select = byLabel<HTMLSelectElement>(host, "Who can fill it in");
    const token = [...select.options].find((o) => o.value === "token")!;
    expect(token.textContent).toBe("Personal link only");
    expect(host.textContent).not.toContain("comes later");
  });

  it("as the event builder, keeps sending the event settings and no access mode", async () => {
    const fetchMock = stubFetch();
    const host = mount({
      eventId: "event-1",
      form: { ...meta, access_mode: undefined, records_attendance: true, label_id: "label-1" },
      labels: [{ id: "label-1", slug: "send", name: "Send Night", color: null }],
    });
    expect(host.textContent).toContain("Event form");
    expect(host.textContent).toContain("Submitting records event attendance");
    expect(host.querySelector('[aria-label="Who can fill it in"]')).toBeNull();
    await act(async () => {
      byText(host, "button", "Save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ name: "Weekly house feedback", label_id: "label-1", records_attendance: true, is_active: false });
    expect(body).not.toHaveProperty("access_mode");
  });
});
