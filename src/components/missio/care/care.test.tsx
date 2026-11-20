/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CareRequest } from "@/lib/missio/care";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import { ago, CareBoard, takeMessage } from "./board";
import { CareForm } from "./care-form";
import type { CareClient } from "./client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/missio/fonts", () => ({ missioBody: { variable: "", className: "" }, missioDisplay: { variable: "" } }));

const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));
function mount(node: ReactNode) {
  const shown = render(node);
  roots.push(shown.root);
  hosts.push(shown.host);
  return shown.host;
}
const button = (host: ParentNode, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

const request = (over: Partial<CareRequest>): CareRequest => ({
  id: "r1",
  source: "care_form",
  name: "Thabo Nkosi",
  phone: "071 555 8890",
  needs: ["prayer", "practical"],
  body: "Mom in hospital until next week. Meals for my sisters would help.",
  privacy: "pastors_leaders",
  urgent: false,
  status: "new",
  house: null,
  takenBy: null,
  createdAt: new Date(Date.now() - 26 * 3600000).toISOString(),
  takenAt: null,
  doneAt: null,
  doneNote: null,
  checkIn: false,
  ...over,
});

describe("CareForm", () => {
  it("asks what they'd like, who can know, and needs a phone for practical help", async () => {
    const sent: unknown[] = [];
    const host = mount(
      <CareForm
        submit={async (body) => {
          sent.push(body);
          return { first: "Thabo" };
        }}
      />
    );
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(host.textContent).toContain("Choose at least one.");
    const boxes = [...host.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    act(() => boxes[0]!.click());
    act(() => boxes[2]!.click());
    setValue(host.querySelector("textarea") as HTMLTextAreaElement, "Meals would help.");
    await settle();
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(host.textContent).toContain("Who can know about this?");
    expect(host.textContent).toContain("Call 112");
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(host.textContent).toContain("Add a phone number so someone can reply.");
    const inputs = [...host.querySelectorAll("form input:not([type])")] as HTMLInputElement[];
    setValue(inputs[0]!, "Thabo Nkosi");
    setValue(inputs[1]!, "071 555 8890");
    await settle();
    const consent = [...host.querySelectorAll("input[type=checkbox]")].pop() as HTMLInputElement;
    act(() => consent.click());
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(sent[0]).toMatchObject({ needs: ["prayer", "practical"], privacy: "pastors", phone: "071 555 8890", consent: true });
    expect(host.querySelector("[data-testid=care-thanks]")?.textContent).toContain("We’ve got you, Thabo.");
  });
});

describe("CareBoard", () => {
  it("puts urgent first, takes a request with a ready message, and offers to check back in", async () => {
    const steps: unknown[] = [];
    let rows = [
      request({ id: "u", name: "Sizwe Mahlangu", needs: ["talk"], urgent: true, body: "Lost my job." , privacy: "pastors"}),
      request({}),
      request({ id: "d", name: "Mia Grobler", status: "done", takenBy: { id: "x", name: "Gabriël V" }, doneAt: "2026-11-01T08:00:00Z", checkIn: true }),
    ];
    const client: CareClient = {
      list: async () => ({ requests: rows, me: "Gabriël" }),
      step: async (id, action) => {
        steps.push([id, action]);
        rows = rows.map((row) => (row.id === id && action === "take" ? { ...row, status: "on_it", takenBy: { id: "me", name: "Gabriël V" } } : row));
      },
      log: async () => undefined,
    };
    const host = mount(<CareBoard client={client} origin="https://hub.example" />);
    await settle();
    const fresh = host.querySelector("[data-testid=care-new]")!;
    expect(fresh.querySelectorAll("[data-testid=care-card]")[0]!.textContent).toContain("Urgent");
    expect(fresh.textContent).toContain("Care form · yesterday");
    expect(host.querySelector("[data-testid=care-done]")?.textContent).toContain("Two weeks on: how are things now?");
    act(() => button(fresh.querySelectorAll("[data-testid=care-card]")[1]!, "I’ll take it").click());
    const dialog = document.body.querySelector("[data-testid=care-take]")!;
    expect((dialog.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Hi Thabo, it’s Gabriël from Missio. Thank you for telling us. We’re praying for you. How are you doing?"
    );
    const send = [...dialog.querySelectorAll("a")].find((a) => a.textContent === "Send & take it") as HTMLAnchorElement;
    expect(send.href).toContain("wa.me/27715558890");
    send.addEventListener("click", (event) => event.preventDefault());
    await act(async () => send.click());
    await settle();
    expect(steps).toEqual([["r1", "take"]]);
    expect(host.querySelector("[data-testid=care-on_it]")?.textContent).toContain("Thabo Nkosi");
  });

  it("words the time and an anonymous reply", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    expect(ago("2026-11-20T08:00:00Z", now)).toBe("2 hours ago");
    expect(ago("2026-11-15T10:00:00Z", now)).toBe("5 days ago");
    expect(takeMessage(request({ name: null, needs: ["talk"] }), "")).toBe("Hi, it’s Missio. Thank you for telling us. How are you doing?");
  });
});
