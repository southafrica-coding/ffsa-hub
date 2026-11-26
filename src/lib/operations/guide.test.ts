import { describe, expect, it } from "vitest";
import { cleanLink, cleanPage, hubGuideProblems, parseBody, shortUrl, spans } from "./guide";

describe("parseBody", () => {
  it("reads headings, lists, numbered lists and paragraphs", () => {
    const body = [
      "## Before they land",
      "Send the Welcoming Guide first.",
      "It has two versions.",
      "",
      "- SA + Potch",
      "- Potch only",
      "1. Form 1",
      "2) Form 2",
      "# Here",
      "Pick them up.",
    ].join("\n");
    expect(parseBody(body)).toEqual([
      { h: "Before they land" },
      { p: "Send the Welcoming Guide first. It has two versions." },
      { ul: ["SA + Potch", "Potch only"] },
      { ol: ["Form 1", "Form 2"] },
      { h: "Here" },
      { p: "Pick them up." },
    ]);
  });

  it("handles Windows line endings and bullets typed as •", () => {
    expect(parseBody("• one\r\n• two\r\n\r\nend")).toEqual([{ ul: ["one", "two"] }, { p: "end" }]);
  });

  it("gives nothing for an empty page", () => {
    expect(parseBody("  \n\n ")).toEqual([]);
  });
});

describe("spans", () => {
  it("finds bare links and [words](links), and leaves trailing punctuation out", () => {
    expect(spans("See https://docs.google.com/document/d/abc, or [the form](https://forms.gle/x).")).toEqual([
      { text: "See " },
      { text: "docs.google.com/…", href: "https://docs.google.com/document/d/abc" },
      { text: ", or " },
      { text: "the form", href: "https://forms.gle/x" },
      { text: "." },
    ]);
  });

  it("never makes a link from anything but http(s)", () => {
    expect(spans("[x](javascript:alert(1)) and mailto:a@b.c")).toEqual([{ text: "[x](javascript:alert(1)) and mailto:a@b.c" }]);
  });

  it("shortens addresses", () => {
    expect(shortUrl("https://www.example.org/")).toBe("example.org");
    expect(shortUrl("not a url")).toBe("not a url");
  });
});

describe("cleanPage / cleanLink", () => {
  it("needs a title", () => {
    expect(cleanPage({ title: "  ", body: "x" })).toEqual({ ok: false, error: "Give the page a title" });
    expect(cleanPage({ title: " Steps ", body: "x" })).toEqual({ ok: true, value: { title: "Steps", body: "x" } });
  });

  it("changes only what's sent", () => {
    expect(cleanPage({ body: "new" }, true)).toEqual({ ok: true, value: { body: "new" } });
    expect(cleanPage({}, true)).toEqual({ ok: false, error: "Nothing to change" });
  });

  it("only takes http(s) links, and empties become null", () => {
    expect(cleanLink({ title: "Form 1", url: "javascript:alert(1)" }).ok).toBe(false);
    expect(cleanLink({ title: "Form 1", url: " ", note: "", section: "Forms" })).toEqual({
      ok: true,
      value: { title: "Form 1", url: null, note: null, section: "Forms" },
    });
  });
});

describe("How the Hub does it", () => {
  it("has only real areas, unique pages and dated changes", () => {
    expect(hubGuideProblems()).toEqual([]);
  });
});
