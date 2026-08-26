// Minimal markdown renderer for the consent agreement. Handles the
// subset we actually use: # / ## headings, **bold**, hyphen bullet
// lists, horizontal rules (---), and paragraphs. Anything fancier
// belongs in a real library — keep this honest about what it supports.
//
// Colour is INHERITED from whatever wraps it, never taken from the
// global theme. These documents render on three different surfaces —
// the dark public brand shell, the white print sheet, the Hub itself —
// and hardcoding `text-foreground` (near-black since the light redesign)
// painted the policy black-on-black inside the dark shell, i.e. the
// document opened but read as an empty page. Hierarchy comes from
// weight and opacity, which survive any background.
//
// The headings carry an INLINE `color: inherit` on purpose: globals.css
// has a base-layer `h1..h6 { color: var(--text-primary) }` rule that beats
// plain inheritance, and --text-primary is near-black — the same trap that
// hid the body text. Inline style is what actually wins there.

import { Fragment } from "react";

function renderInline(text: string): React.ReactNode[] {
  // Split on **bold** segments while keeping the markers.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push(
      <p key={`p-${nodes.length}`} className="text-sm leading-relaxed opacity-90">
        {renderInline(paragraph.join(" "))}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="list-disc pl-6 space-y-1 text-sm opacity-90">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (line === "---") {
      flushParagraph();
      flushList();
      nodes.push(<hr
          key={`hr-${nodes.length}`}
          style={{ border: 0, borderTop: "1px solid currentColor", opacity: 0.25 }}
        />);
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      nodes.push(
        <h1
          key={`h1-${nodes.length}`}
          className="text-2xl font-bold tracking-tight"
          style={{ color: "inherit" }}
        >
          {renderInline(line.slice(2))}
        </h1>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      nodes.push(
        <h2
          key={`h2-${nodes.length}`}
          className="text-lg font-semibold tracking-tight mt-4"
          style={{ color: "inherit" }}
        >
          {renderInline(line.slice(3))}
        </h2>
      );
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="space-y-4">{nodes}</div>;
}
