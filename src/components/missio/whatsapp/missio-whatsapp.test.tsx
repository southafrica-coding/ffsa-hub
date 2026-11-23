/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxResponse, MessageView, TemplatesResponse, ThreadResponse } from "@/lib/missio/whatsapp/types";
import { missioCrumbLabel } from "../crumb";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import { ContactActions } from "../person-profile";
import type { MissioMe } from "../types-shim";
import { MissioViewerProvider } from "../viewer";
import { WhatsAppApiError, type WhatsAppClient } from "./client";
import { composerMode } from "./composer";
import { MissioWhatsApp } from "./missio-whatsapp";

// Fake data only: made-up names and numbers, no API, no Meta.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

const NOW = new Date("2026-11-23T14:00:00.000Z");
const PERSON = "00000000-0000-4000-8000-000000000001";

const pastor: MissioMe = { orgs: [{ id: "o", slug: "missio", name: "Missio" }], rolesByOrg: { missio: ["pastor"] }, currentOrg: "missio" };
const leader: MissioMe = { orgs: [{ id: "o", slug: "missio", name: "Missio" }], rolesByOrg: { missio: ["house_church_leader"] }, currentOrg: "missio" };

const inbox: InboxResponse = {
  setup: "ready",
  threads: [
    { id: "t1", personId: PERSON, name: "Test Person", phone: "+27 82 000 0001", profileName: null, lastAt: "2026-11-23T13:00:00Z", lastPreview: "See you Sunday", lastDirection: "in", lastStatus: "received", unread: 2, optedOut: false },
    { id: "t2", personId: null, name: null, phone: "+27 82 000 0002", profileName: "Visitor", lastAt: "2026-11-20T09:00:00Z", lastPreview: "Thanks!", lastDirection: "out", lastStatus: "read", unread: 0, optedOut: true },
  ],
};

const msg = (over: Partial<MessageView>): MessageView => ({
  id: Math.random().toString(36).slice(2),
  direction: "in",
  kind: "text",
  body: "Hello",
  templateName: null,
  status: "received",
  error: null,
  at: "2026-11-23T13:00:00Z",
  optChange: null,
  ...over,
});

function threadOf(over: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    setup: "ready",
    thread: { id: "t1", unread: 0 },
    person: { id: PERSON, name: "Test Person", phone: "+27 82 000 0001", profileName: null },
    blocked: null,
    optedOut: false,
    optedOutAt: null,
    lastInboundAt: "2026-11-23T13:00:00Z",
    windowEndsAt: "2026-11-24T13:00:00Z",
    messages: [
      msg({ body: "Hi pastor" }),
      msg({ direction: "out", kind: "template", templateName: "hello_name", body: "Hi Test, it's Missio.", status: "read", at: "2026-11-23T13:05:00Z" }),
      msg({ direction: "out", body: "Did it work?", status: "failed", error: "Number not allowed", at: "2026-11-23T13:06:00Z" }),
    ],
    ...over,
  };
}

const helloTemplates: TemplatesResponse = {
  state: "ok",
  templates: [{ name: "hello_name", language: "en", category: "utility", header: null, body: "Hi {{1}}, it's Missio.", footer: null, variables: [{ part: "body", key: "1" }], blockedReason: null }],
};

function fakeClient(over: Partial<WhatsAppClient> = {}): WhatsAppClient & { sent: unknown[]; read: string[] } {
  const sent: unknown[] = [];
  const read: string[] = [];
  return {
    sent,
    read,
    inbox: async () => inbox,
    thread: async () => threadOf(),
    markRead: async (id) => {
      read.push(id);
    },
    templates: async () => helloTemplates,
    send: async (body) => {
      sent.push(body);
      return { threadId: "t1", message: msg({ direction: "out", body: "text" in body ? body.text : "Hi Kea, it's Missio.", status: "accepted", at: NOW.toISOString() }) };
    },
    ...over,
  };
}

describe("WhatsApp inbox", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    nav.search = "";
  });
  function mount(node: ReactNode, me: MissioMe = pastor) {
    const view = render(<MissioViewerProvider me={me}>{node}</MissioViewerProvider>);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("is for pastors only", async () => {
    const client = fakeClient();
    const spy = vi.spyOn(client, "inbox");
    const host = mount(<MissioWhatsApp client={client} />, leader);
    await settle();
    expect(host.querySelector("[data-testid=missio-whatsapp-denied]")?.textContent).toContain("For pastors");
    expect(spy).not.toHaveBeenCalled();
  });

  it("lists conversations with names, unread, status words and unmatched numbers", async () => {
    const host = mount(<MissioWhatsApp client={fakeClient()} now={() => NOW} />);
    await settle();
    const rows = [...host.querySelectorAll("[data-testid=whatsapp-thread-row]")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Test Person");
    expect(rows[0].textContent).toContain("See you Sunday");
    expect(rows[0].querySelector("[aria-label='2 unread']")?.textContent).toBe("2");
    expect(rows[0].getAttribute("href")).toBe("/missio/whatsapp?thread=t1");
    expect(rows[1].textContent).toContain("+27 82 000 0002");
    expect(rows[1].textContent).toContain("Not in People yet");
    expect(rows[1].textContent).toContain("You: Thanks!");
    expect(rows[1].textContent).toContain("Read");
    expect(rows[1].textContent).toContain("Opted out");
  });

  it("says so honestly when there are no conversations, or WhatsApp isn't switched on", async () => {
    let host = mount(<MissioWhatsApp client={fakeClient({ inbox: async () => ({ setup: "ready", threads: [] }) })} />);
    await settle();
    expect(host.querySelector("[data-testid=whatsapp-empty]")?.textContent).toContain("No conversations yet");
    cleanup(roots, hosts);
    host = mount(<MissioWhatsApp client={fakeClient({ inbox: async () => ({ setup: "not_installed", threads: [] }) })} />);
    await settle();
    expect(host.querySelector("[data-testid=whatsapp-setup]")?.textContent).toContain("isn’t switched on yet");
  });

  it("opens a thread with both directions, statuses in words, and the failure reason; marks it read", async () => {
    nav.search = "thread=t1";
    const client = fakeClient({ thread: async () => threadOf({ thread: { id: "t1", unread: 2 } }) });
    const host = mount(<MissioWhatsApp client={client} now={() => NOW} />);
    await settle();
    await settle();
    const items = [...host.querySelectorAll("[data-testid=whatsapp-messages] li[data-direction]")];
    expect(items.map((li) => li.getAttribute("data-direction"))).toEqual(["in", "out", "out"]);
    expect(items[1].textContent).toContain("Approved message · hello name");
    expect(items[1].textContent).toContain("Read");
    expect(items[2].textContent).toContain("Not delivered");
    expect(items[2].textContent).toContain("Number not allowed");
    expect(client.read).toEqual(["t1"]);
  });

  it("inside the window: free text is open and sends", async () => {
    nav.search = `person=${PERSON}`;
    const client = fakeClient();
    const host = mount(<MissioWhatsApp client={client} now={() => NOW} />);
    await settle();
    const form = host.querySelector("[data-testid=composer-free]") as HTMLFormElement;
    expect(form.textContent).toContain("Free reply open");
    setValue(form.querySelector("textarea") as HTMLTextAreaElement, "See you Sunday");
    await settle();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(client.sent).toEqual([{ threadId: "t1", text: "See you Sunday" }]);
  });

  it("outside the window: free text is gone, the reason is explained, and a template is sent", async () => {
    nav.search = `person=${PERSON}`;
    const client = fakeClient({ thread: async () => threadOf({ lastInboundAt: "2026-11-21T13:00:00Z", windowEndsAt: null, thread: null, messages: [] }) });
    const host = mount(<MissioWhatsApp client={client} now={() => NOW} />);
    await settle();
    await settle();
    expect(host.querySelector("[data-testid=composer-free]")).toBeNull();
    const sheet = host.querySelector("[data-testid=composer-template]") as HTMLElement;
    expect(sheet.textContent).toContain("only allows a free reply for 24 hours");
    (sheet.querySelector("input[type=radio]") as HTMLInputElement).click();
    await settle();
    setValue(sheet.querySelector("input:not([type=radio])") as HTMLInputElement, "Kea");
    await settle();
    expect(sheet.textContent).toContain("Hi Kea, it’s Missio.".replace("’", "'"));
    (sheet.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(client.sent).toEqual([{ personId: PERSON, template: { name: "hello_name", language: "en", values: { "body:1": "Kea" } } }]);
  });

  it("no approved templates: an honest empty state and nothing to send", async () => {
    nav.search = `person=${PERSON}`;
    const client = fakeClient({
      thread: async () => threadOf({ lastInboundAt: null, windowEndsAt: null, thread: null, messages: [] }),
      templates: async () => ({ state: "ok", templates: [] }),
    });
    const host = mount(<MissioWhatsApp client={client} now={() => NOW} />);
    await settle();
    await settle();
    expect(host.querySelector("[data-testid=composer-no-templates]")?.textContent).toContain("No approved messages yet");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("button[type=submit]")).toBeNull();
  });

  it("opted out: no composer, and the thread says why", async () => {
    nav.search = "thread=t1";
    const client = fakeClient({ thread: async () => threadOf({ optedOut: true, messages: [msg({ body: "STOP", optChange: "opt_out" })] }) });
    const host = mount(<MissioWhatsApp client={client} now={() => NOW} />);
    await settle();
    expect(host.querySelector("[data-testid=composer-opted-out]")?.textContent).toContain("They’ve opted out");
    expect(host.querySelector("[data-testid=whatsapp-opt-note]")?.textContent).toContain("They opted out");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("not switched on: no composer", async () => {
    nav.search = "thread=t1";
    const host = mount(<MissioWhatsApp client={fakeClient({ thread: async () => threadOf({ setup: "not_configured" }) })} now={() => NOW} />);
    await settle();
    expect(host.querySelector("[data-testid=composer-not-configured]")?.textContent).toContain("isn’t switched on yet");
  });

  it("shows a failed send in the thread with WhatsApp's reason", async () => {
    nav.search = "thread=t1";
    const failed = msg({ direction: "out", body: "Hi", status: "failed", error: "Number not allowed", at: NOW.toISOString() });
    let stored: MessageView[] = [];
    const client = fakeClient({
      // Like the database: the failed row is kept, so the reload still has it.
      thread: async () => threadOf({ messages: stored }),
      send: async () => {
        stored = [failed];
        throw new WhatsAppApiError(502, "WhatsApp didn't take it: Number not allowed", "send_failed", { message: failed });
      },
    });
    const host = mount(<MissioWhatsApp client={client} now={() => NOW} />);
    await settle();
    const form = host.querySelector("[data-testid=composer-free]") as HTMLFormElement;
    setValue(form.querySelector("textarea") as HTMLTextAreaElement, "Hi");
    await settle();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Number not allowed");
    expect(host.querySelector("li[data-status=failed]")).not.toBeNull();
  });
});

describe("composerMode", () => {
  it("puts blocks before the window", () => {
    expect(composerMode(threadOf({ setup: "not_installed" }), NOW)).toBe("not_installed");
    expect(composerMode(threadOf({ blocked: "no_phone" }), NOW)).toBe("no_phone");
    expect(composerMode(threadOf({ optedOut: true }), NOW)).toBe("opted_out");
    expect(composerMode(threadOf({ setup: "not_configured" }), NOW)).toBe("not_configured");
    expect(composerMode(threadOf(), NOW)).toBe("free");
    expect(composerMode(threadOf({ lastInboundAt: "2026-11-22T13:59:00Z" }), NOW)).toBe("template");
    expect(composerMode(threadOf({ lastInboundAt: null }), NOW)).toBe("template");
  });
});

describe("the WhatsApp button on a person", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => cleanup(roots, hosts));
  function mount(node: ReactNode, me: MissioMe | null) {
    const view = render(me ? <MissioViewerProvider me={me}>{node}</MissioViewerProvider> : node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }
  const whatsapp = (host: HTMLElement) => [...host.querySelectorAll("a")].find((a) => a.textContent === "WhatsApp");

  it("opens the Hub conversation for a pastor, never wa.me", () => {
    const host = mount(<ContactActions phone="082 000 0001" email={null} personId={PERSON} />, pastor);
    const link = whatsapp(host)!;
    expect(link.getAttribute("href")).toBe(`/missio/whatsapp?person=${PERSON}`);
    expect(link.getAttribute("target")).toBeNull();
  });

  it("stays a wa.me link (their own phone) for a leader", () => {
    const host = mount(<ContactActions phone="082 000 0001" email={null} personId={PERSON} />, leader);
    expect(whatsapp(host)?.getAttribute("href")).toBe("https://wa.me/27820000001");
  });

  it("hides when there's no phone, or it won't normalise", () => {
    expect(whatsapp(mount(<ContactActions phone={null} email="a@example.org" personId={PERSON} />, pastor))).toBeUndefined();
    expect(whatsapp(mount(<ContactActions phone="082 000 00" email="a@example.org" personId={PERSON} />, pastor))).toBeUndefined();
  });

  it("names the page in the top bar", () => {
    expect(missioCrumbLabel("/missio/whatsapp")).toBe("WhatsApp");
  });
});
