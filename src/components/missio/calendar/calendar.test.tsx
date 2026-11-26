/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarEventInput } from "@/lib/missio/calendar/types";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import type { MissioMe } from "../types-shim";
import { MissioViewerProvider } from "../viewer";
import { MissioCalendarPage, PublicCalendar } from "./calendar";
import { CalendarApiError, type CalendarClient } from "./client";
import { draftFromEvent, draftToInput, newDraft } from "./event-sheet";

vi.mock("@/components/missio/fonts", () => ({
  missioBody: { variable: "", className: "" },
  missioDisplay: { variable: "" },
  missioMono: { variable: "" },
}));

const NOW = new Date("2026-11-23T13:08:00Z");
const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));
beforeEach(() => window.history.replaceState(null, "", "/missio/calendar"));

function mount(node: ReactNode) {
  const shown = render(node);
  roots.push(shown.root);
  hosts.push(shown.host);
  return shown.host;
}
const buttons = () => [...document.querySelectorAll("button")];
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};

const me = (role: "pastor" | "house_church_leader" | "coach"): MissioMe => ({
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: [role] },
  currentOrg: "missio",
});

const camp: CalendarEvent = {
  id: "e1",
  title: "Youth camp",
  description: null,
  location: "Magaliesberg",
  category: "events",
  campus: "jhb",
  startsOn: "2026-11-27",
  endsOn: "2026-11-29",
  startTime: null,
  endTime: null,
  repeat: null,
  skipDates: [],
  source: "missio",
};

function fakeClient(over: Partial<CalendarClient> = {}, events: CalendarEvent[] = []) {
  const created: CalendarEventInput[] = [];
  const removed: string[] = [];
  const client: CalendarClient = {
    list: async () => ({ available: true, events }),
    create: async (input) => (created.push(input), { ...camp, ...input, id: "new", source: "missio" }),
    update: async (id, input) => ({ ...camp, ...input, id, source: "missio" }),
    remove: async (id) => void removed.push(id),
    share: async () => ({
      feedUrl: "https://www.ffsahub.com/api/serve/missio/calendar/TOKEN.ics",
      webUrl: "https://www.ffsahub.com/serve/missio/calendar/TOKEN",
      prefix: "TOKEN",
      rotatedAt: null,
    }),
    ...over,
  };
  return { client, created, removed };
}

async function page(client: CalendarClient, role: "pastor" | "house_church_leader" | "coach" = "pastor") {
  const host = mount(
    <MissioViewerProvider me={me(role)}>
      <MissioCalendarPage client={client} now={NOW} />
    </MissioViewerProvider>
  );
  await settle();
  return host;
}

describe("MissioCalendarPage", () => {
  it("is for pastors only", async () => {
    for (const role of ["house_church_leader", "coach"] as const) {
      const { client } = fakeClient({ list: vi.fn() });
      const host = await page(client, role);
      expect(host.querySelector("[data-testid=calendar-pastors-only]")).not.toBeNull();
      expect(host.querySelector("[data-testid=calendar-add]")).toBeNull();
      expect(client.list).not.toHaveBeenCalled();
    }
  });

  it("shows an honest empty year with holidays and school terms already in", async () => {
    const host = await page(fakeClient().client);
    expect(host.querySelector("[data-testid=calendar-empty]")?.textContent).toContain("No Missio events yet");
    expect(host.querySelector("[data-testid=calendar-year]")?.textContent).toContain("Day of Reconciliation");
    expect(host.querySelector("h2")?.textContent).toBe("2026");
    expect(host.querySelector("[data-current]")?.textContent).toContain("November");
  });

  it("says the calendar isn't switched on yet before the migration", async () => {
    const host = await page(fakeClient({ list: async () => ({ available: false, events: [] }) }).client);
    expect(host.querySelector("[data-testid=calendar-unavailable]")).not.toBeNull();
    expect(host.querySelector("[data-testid=calendar-year]")?.textContent).toContain("Christmas Day");
  });

  it("hides holidays with the filter and keeps the filter in the address bar", async () => {
    const host = await page(fakeClient({}, [camp]).client);
    await click(button("Holidays & school"));
    expect(host.querySelector("[data-testid=calendar-year]")?.textContent).not.toContain("Christmas Day");
    expect(window.location.search).toBe("?cats=sundays%2Chouse_church%2Cevents%2Cleaders");
    await click(button("Potch"));
    expect(host.querySelector("[data-testid=calendar-year]")?.textContent).not.toContain("Youth camp");
    expect(window.location.search).toContain("campus=potch");
  });

  it("adds an event from the sheet", async () => {
    const fake = fakeClient();
    const host = await page(fake.client);
    await click(host.querySelector("[data-testid=calendar-add]")!);
    const sheet = document.querySelector("[data-testid=calendar-edit]")!;
    const title = sheet.querySelector("input") as HTMLInputElement;
    await act(async () => setValue(title, "Christmas service"));
    await click([...sheet.querySelectorAll("input[type=radio]")][0]!); // Sundays & special services
    await click(button("Add to calendar"));
    expect(fake.created).toEqual([
      expect.objectContaining({ title: "Christmas service", category: "sundays", campus: "all", startsOn: "2026-11-23", startTime: null, repeat: null }),
    ]);
    expect(document.querySelector("[data-testid=calendar-edit]")).toBeNull();
    expect(host.textContent).toContain("Added “Christmas service”.");
  });

  it("shows the server's field errors and a fixed message when saving fails", async () => {
    const fake = fakeClient({
      create: async () => {
        throw new CalendarApiError(503, "not_available");
      },
    });
    const host = await page(fake.client);
    await click(host.querySelector("[data-testid=calendar-add]")!);
    const sheet = document.querySelector("[data-testid=calendar-edit]")!;
    await act(async () => setValue(sheet.querySelector("input") as HTMLInputElement, "Camp"));
    await click(button("Add to calendar"));
    expect(sheet.textContent).toContain("The calendar isn’t switched on yet");
  });

  it("deletes only after a second, deliberate confirm", async () => {
    window.history.replaceState(null, "", "/missio/calendar?view=agenda");
    const fake = fakeClient({}, [camp]);
    await page(fake.client);
    await click(buttons().find((b) => b.textContent?.includes("Youth camp"))!);
    await click(button("Delete…"));
    const confirm = document.querySelector("[data-testid=calendar-delete]")!;
    expect(confirm.textContent).toContain("There’s no undo");
    expect(document.activeElement?.textContent).toBe("Keep it");
    expect(fake.removed).toEqual([]);
    await click(button("Delete for good"));
    expect(fake.removed).toEqual(["e1"]);
  });

  it("opens public holidays read-only", async () => {
    window.history.replaceState(null, "", "/missio/calendar?view=agenda&m=12");
    await page(fakeClient().client);
    await click(buttons().find((b) => b.textContent?.includes("Day of Reconciliation"))!);
    const detail = document.querySelector("[data-testid=calendar-detail]")!;
    expect(detail.textContent).toContain("can’t be edited here");
    expect(detail.querySelector("input")).toBeNull();
  });

  it("shares: Google subscribe, webcal and the copyable .ics link", async () => {
    const host = await page(fakeClient().client);
    await click(host.querySelector("[data-testid=calendar-share-open]")!);
    const sheet = document.querySelector("[data-testid=calendar-share]")!;
    const feed = "https://www.ffsahub.com/api/serve/missio/calendar/TOKEN.ics";
    expect(sheet.querySelector("[data-testid=calendar-google]")?.getAttribute("href")).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent("webcal://www.ffsahub.com/api/serve/missio/calendar/TOKEN.ics")}`
    );
    expect(sheet.querySelector("[data-testid=calendar-webcal]")?.getAttribute("href")).toBe("webcal://www.ffsahub.com/api/serve/missio/calendar/TOKEN.ics");
    expect((sheet.querySelector("[data-testid=calendar-feed-url]") as HTMLInputElement).value).toBe(feed);
    const toggle = [...sheet.querySelectorAll("input[type=checkbox]")][0] as HTMLInputElement;
    await click(toggle);
    expect((sheet.querySelector("[data-testid=calendar-feed-url]") as HTMLInputElement).value).toBe(`${feed}?national=0`);
  });
});

describe("PublicCalendar", () => {
  it("has no edit controls", async () => {
    const host = mount(<PublicCalendar name="Missio" events={[camp]} now={NOW} />);
    await settle();
    expect(host.textContent).toContain("Read-only calendar");
    expect(host.querySelector("[data-testid=calendar-add]")).toBeNull();
    expect(host.querySelector("[data-testid=calendar-share-open]")).toBeNull();
    expect(buttons().some((b) => b.textContent?.includes("Add on this day"))).toBe(false);
  });
});

describe("drafts", () => {
  it("sends all-day as no times, and a repeat with its end", () => {
    const draft = { ...newDraft("2026-11-29"), title: " Sunday ", category: "sundays" as const, allDay: false, every: 1, endMode: "count" as const, count: "8" };
    expect(draftToInput(draft)).toMatchObject({ title: "Sunday", startTime: "09:00", endTime: "11:00", repeat: { every: 1, until: null, count: 8 } });
    expect(draftToInput({ ...draft, allDay: true, every: 0 })).toMatchObject({ startTime: null, endTime: null, repeat: null, skipDates: [] });
    expect(draftToInput(draftFromEvent(camp))).toMatchObject({ title: "Youth camp", campus: "jhb", startsOn: "2026-11-27", endsOn: "2026-11-29" });
  });
});
