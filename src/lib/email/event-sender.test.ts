import { describe, it, expect } from "vitest";
import { brandIdentitySlugs, eventHeaderLogo, eventLogoBlock, resolveEventSender } from "./event-sender";

type Row = { id: string; slug: string; from_email: string; from_name: string; reply_to: string | null; is_active?: boolean };

// A tiny stand-in for the two sending_identities reads the resolver makes.
function fakeDb(rows: Row[]) {
  return {
    from() {
      const filters: Array<(r: Row) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: keyof Row, v: unknown) => (filters.push((r) => (r[col] ?? true) === v), q),
        in: (col: keyof Row, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) ?? null }),
        then: (res: (v: { data: Row[] }) => unknown) => res({ data: rows.filter((r) => filters.every((f) => f(r))) }),
      };
      return q;
    },
  };
}

const events: Row = { id: "e", slug: "events", from_email: "admin@ffsouthafrica.com", from_name: "FFSA Events", reply_to: "events@ffsahub.com", is_active: true };
const send: Row = { id: "s", slug: "the-send-south-africa", from_email: "admin@ffsouthafrica.com", from_name: "The Send South Africa", reply_to: "events@ffsahub.com", is_active: true };
const own: Row = { id: "o", slug: "ff-global", from_email: "global@ffsouthafrica.com", from_name: "FF Global Leaders Gathering", reply_to: "ff-global@ffsahub.com", is_active: true };

describe("resolveEventSender", () => {
  it("uses the event's own sender first", async () => {
    const s = await resolveEventSender(fakeDb([events, own]), { sending_identity_id: "o" }, "ff");
    expect(s).toMatchObject({ fromName: "FF Global Leaders Gathering", fromEmail: "global@ffsouthafrica.com", replyTo: "ff-global@ffsahub.com", identityId: "o" });
  });

  it("falls back to the brand sender when the event's is gone", async () => {
    const s = await resolveEventSender(fakeDb([events]), { sending_identity_id: "missing" }, "ff");
    expect(s.identityId).toBe("e");
  });

  it("finds The Send's sender under its production slug", async () => {
    const s = await resolveEventSender(fakeDb([events, send]), {}, "the_send");
    expect(s.fromName).toBe("The Send South Africa");
  });

  it("uses the shared events sender for a brand without its own", async () => {
    const s = await resolveEventSender(fakeDb([events]), {}, "preachers");
    expect(s.identityId).toBe("e");
  });

  it("falls back to the environment default when no sender exists", async () => {
    const s = await resolveEventSender(fakeDb([]), {}, "ff");
    expect(s).toMatchObject({ fromName: "Fire & Fragrance SA", replyTo: null, identityId: null });
  });
});

describe("event logo", () => {
  it("only shows the logo when the event asked for it", () => {
    expect(eventHeaderLogo({ logo_url: "https://x/logo.png", email_show_event_logo: false })).toBeNull();
    expect(eventHeaderLogo({ logo_url: "https://x/logo.png", email_show_event_logo: true })).toBe("https://x/logo.png");
    expect(eventHeaderLogo({ logo_url: null, email_show_event_logo: true })).toBeNull();
    expect(eventHeaderLogo({ logo_url: "javascript:alert(1)", email_show_event_logo: true })).toBeNull();
  });

  it("renders nothing without a logo and escapes the url", () => {
    expect(eventLogoBlock(null)).toBe("");
    expect(eventLogoBlock('https://x/a"b.png', "A & B")).toContain('src="https://x/a&quot;b.png"');
    expect(eventLogoBlock("https://x/a.png", "A & B")).toContain('alt="A &amp; B"');
  });

  it("tries a brand's own slug before the shared events sender", () => {
    expect(brandIdentitySlugs("the_send")).toEqual(["the-send", "the-send-south-africa", "events"]);
    expect(brandIdentitySlugs("wild_ones")).toEqual(["events"]);
  });
});
