/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlacementView } from "@/lib/missio/placements";
import { cleanup, render, settle } from "../house-churches/test-render";
import { placementMessages } from "./messages";
import { PlaceDialog } from "./place-dialog";
import { LeaderSteps, PersonNextSteps } from "./public";
import { PlacementTracker } from "./tracker";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const view = (over: Partial<PlacementView> = {}): PlacementView => ({
  id: "p1",
  person: { contactId: "c-sipho", name: "Sipho Dlamini", phone: "082 555 0101" },
  house: { id: "h5", number: 5, name: null, meetingDay: "wednesday", location: null },
  leaders: [{ name: "Chris Naidoo", phone: "083 555 0202" }],
  placedAt: "2026-11-16T08:00:00Z",
  leaderDeadline: "2026-11-19",
  saidHiAt: null,
  firstVisitAt: null,
  joinedAt: null,
  cancelledAt: null,
  cantMakeItAt: null,
  next: "said_hi",
  overdue: false,
  links: { person: "/serve/missio/w/PERSON", leader: "/serve/missio/l/LEADER" },
  ...over,
});

const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));
function mount(node: ReactNode) {
  const shown = render(node);
  roots.push(shown.root);
  hosts.push(shown.host);
  return shown.host;
}
const inDoc = () => document.body;

describe("placement messages", () => {
  it("writes the person's and the leader's WhatsApp with their links", () => {
    const { toPerson, toLeader } = placementMessages(view(), "https://hub.example");
    expect(toPerson).toContain("House 5, Wednesdays");
    expect(toPerson).toContain("Chris will message you");
    expect(toPerson).toContain("https://hub.example/serve/missio/w/PERSON");
    expect(toLeader).toContain("Sipho Dlamini is joining House 5");
    expect(toLeader).toContain("082 555 0101");
    expect(toLeader).toContain("https://hub.example/serve/missio/l/LEADER");
  });
});

describe("PlaceDialog", () => {
  it("places in the chosen house, then offers the two WhatsApps", async () => {
    const created: string[] = [];
    mount(
      <PlaceDialog
        name="Sipho Dlamini"
        resolveContact={async () => "c-sipho"}
        houses={{
          listHouses: async () =>
            ({
              houses: [
                { id: "h5", number: 5, name: null, meetingDay: "wednesday", memberCount: 9, leaders: [], coLeaders: [], coaches: [] },
                { id: "h2", number: 2, name: null, meetingDay: "tuesday", memberCount: 4, leaders: [], coLeaders: [], coaches: [] },
              ],
            }) as never,
        }}
        placements={{
          create: async (contactId, houseId) => {
            created.push(`${contactId}:${houseId}`);
            return view();
          },
        }}
        onClose={() => undefined}
        onPlaced={() => undefined}
      />
    );
    await settle();
    const choices = [...inDoc().querySelectorAll("[role=radio]")] as HTMLButtonElement[];
    expect(choices[0]!.textContent).toContain("House 2");
    act(() => choices[1]!.click());
    const place = [...inDoc().querySelectorAll("button")].find((b) => b.textContent?.startsWith("Place in")) as HTMLButtonElement;
    await act(async () => place.click());
    await settle();
    expect(created).toEqual(["c-sipho:h5"]);
    expect(inDoc().querySelector("[data-testid=msg-person]")?.textContent).toContain("/serve/missio/w/PERSON");
    const send = [...inDoc().querySelectorAll("a")].find((a) => a.textContent === "Send to Chris") as HTMLAnchorElement;
    expect(send.href).toContain("wa.me/27835550202");
  });
});

describe("PlacementTracker", () => {
  it("shows the steps, warns when the leader is late and moves to the next step", async () => {
    const steps: string[] = [];
    const host = mount(
      <PlacementTracker
        client={{
          list: async () => ({ placements: [view({ overdue: true })], canPlace: true }),
          create: async () => view(),
          step: async (id, step) => {
            steps.push(`${id}:${step}`);
            return view({ saidHiAt: "2026-11-19T08:00:00Z", next: "first_visit" });
          },
        }}
      />
    );
    await settle();
    expect(host.textContent).toContain("1 settling in");
    expect(host.textContent).toContain("Chris hasn’t said hi yet");
    expect(host.textContent).toContain("Nudge Chris");
    const hi = [...host.querySelectorAll("button")].find((b) => b.textContent === "Leader said hi") as HTMLButtonElement;
    await act(async () => hi.click());
    await settle();
    expect(steps).toEqual(["p1:said_hi"]);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "They came")).toBe(true);
  });
});

describe("no-login pages", () => {
  it("keeps the address back until the leader has said hi", () => {
    const host = mount(<PersonNextSteps token="t" view={view({ links: undefined, person: { contactId: "c", name: "Sipho Dlamini", phone: null } })} />);
    expect(host.textContent).not.toContain("12 Oak");
    expect(host.textContent).toContain("Chris");
  });

  it("lets the leader tap that they said hi", async () => {
    const sent: unknown[] = [];
    const host = mount(
      <LeaderSteps
        token="t"
        view={view({ leaders: [], links: undefined })}
        send={async (_url, body) => {
          sent.push(body);
          return { placement: view({ leaders: [], saidHiAt: "x", next: "first_visit" }) };
        }}
      />
    );
    const button = host.querySelector("button[type=submit]") as HTMLButtonElement;
    await act(async () => button.click());
    await settle();
    expect(sent).toEqual([{ step: "said_hi" }]);
  });
});

describe("placing a household", () => {
  it("offers the whole household, shows the new size and sends one family message", async () => {
    const created: unknown[] = [];
    mount(
      <PlaceDialog
        name="Yolanda Pillay"
        contactId="c-yolanda"
        resolveContact={async () => "c-yolanda"}
        households={{
          forContact: async () => ({
            id: "hh",
            title: "The Pillays",
            name: null,
            mainContactId: "c-yolanda",
            greeting: "Hi Yolanda & Kevin",
            adults: [
              { memberId: "a1", contactId: "c-yolanda", personId: null, name: "Yolanda Pillay", firstName: "Yolanda", label: null, main: true, houses: [] },
              { memberId: "a2", contactId: "c-kevin", personId: null, name: "Kevin Pillay", firstName: "Kevin", label: null, main: false, houses: [] },
            ],
            children: [{ memberId: "k1", firstName: "Aria", lastName: "Pillay", birthYear: 2019 }],
          }),
        }}
        houses={{
          listHouses: async () =>
            ({
              houses: [{ id: "h12", number: 12, name: null, meetingDay: "thursday", memberCount: 10, kidsCount: 2, leaders: [], coLeaders: [], coaches: [] }],
            }) as never,
        }}
        placements={{
          create: async (contactId, houseId, household) => {
            created.push([contactId, houseId, household]);
            return { ...view({ person: { contactId: "c-yolanda", name: "Yolanda Pillay", phone: "082" } }), family: { placed: 2, kids: 1 } };
          },
        }}
        onClose={() => undefined}
        onPlaced={() => undefined}
      />
    );
    await settle();
    expect(inDoc().querySelector("[data-testid=place-family]")?.textContent).toContain("Aria Pillay child · 2019");
    act(() => (inDoc().querySelector("[role=radio]") as HTMLButtonElement).click());
    expect(inDoc().querySelector("[data-testid=place-size]")?.textContent).toContain("House 12 goes from 10 to 12 adults · 3 kids");
    const place = [...inDoc().querySelectorAll("button")].find((b) => b.textContent === "Place 3 in House 12") as HTMLButtonElement;
    await act(async () => place.click());
    await settle();
    expect(created).toEqual([["c-yolanda", "h12", true]]);
    expect(inDoc().querySelector("[data-testid=msg-person]")?.textContent).toMatch(/^Hi Yolanda & Kevin 👋.*kids are welcome/);
    expect(inDoc().querySelector("[data-testid=msg-leader]")?.textContent).toContain("The Pillays (2 adults, 1 kid) are joining House 5");
  });
});
