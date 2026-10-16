import { describe, it, expect } from "vitest";
import { cleanWording, eventMessageHtml, fillTags, unknownTags, wordingFor } from "./event-email-wording";

const vars = { firstName: "Thandi", eventTitle: "FF Global", defaultSubject: "Your tickets for FF Global" };

describe("wordingFor", () => {
  it("sends the standard subject and no message when nothing is set", () => {
    expect(wordingFor({}, "ticket_confirmation", vars)).toEqual({ subject: "Your tickets for FF Global", message: null });
    expect(wordingFor(null, "refund", vars)).toEqual({ subject: "Your tickets for FF Global", message: null });
  });

  it("uses the event's subject and message with merge tags filled", () => {
    const stored = { ticket_confirmation: { subject: "[First Name], you're in for [Event]!", message: "See you there, [first name]." } };
    expect(wordingFor(stored, "ticket_confirmation", vars)).toEqual({
      subject: "Thandi, you're in for FF Global!",
      message: "See you there, Thandi.",
    });
  });

  it("keeps one email's wording off the others", () => {
    const stored = { refund: { subject: "Money back" } };
    expect(wordingFor(stored, "ticket_confirmation", vars).subject).toBe("Your tickets for FF Global");
  });

  it("never carries a message on the cancellation notice", () => {
    const stored = { cancellation_notice: { subject: "Off: [Event]", message: "ignored" } };
    expect(wordingFor(stored, "cancellation_notice", vars)).toEqual({ subject: "Off: FF Global", message: null });
  });
});

describe("cleanWording", () => {
  it("trims, drops empties and unknown emails", () => {
    expect(
      cleanWording({
        ticket_confirmation: { subject: "  Hi   there ", message: "  " },
        refund: { subject: "", message: "" },
        nonsense: { subject: "x" },
      })
    ).toEqual({ ticket_confirmation: { subject: "Hi there" } });
  });
});

describe("tags and html", () => {
  it("reads 'there' with no first name", () => {
    expect(fillTags("Hi [First Name]", { firstName: null, eventTitle: "X" })).toBe("Hi there");
  });

  it("flags bracketed tags it won't fill", () => {
    expect(unknownTags("Hi [First Name], [Last Name] at [Venue]")).toEqual(["[Last Name]", "[Venue]"]);
  });

  it("escapes the message and keeps paragraphs and line breaks", () => {
    const html = eventMessageHtml("<b>Doors</b> at 18:00\nBring a jacket\n\nSee you", { color: "#fff", font: "Arial" });
    expect(html).toContain("&lt;b&gt;Doors&lt;/b&gt; at 18:00<br />Bring a jacket");
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(eventMessageHtml("  ", { color: "#fff", font: "Arial" })).toBe("");
  });
});
