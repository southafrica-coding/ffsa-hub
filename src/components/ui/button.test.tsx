import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

const ROOT = path.resolve(__dirname, "../../..");

function classes(html: string): string[] {
  return (html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
}

describe("Button text on filled variants", () => {
  // --bg turns near-black under html.dark, so text-bg on the black fill
  // would be black on black. The fill text must stay white in both modes.
  it("default variant uses the white primary foreground, not text-bg", () => {
    const cls = classes(renderToStaticMarkup(<Button>Save</Button>));
    expect(cls).toContain("bg-brand-black");
    expect(cls).toContain("text-primary-foreground");
    expect(cls).not.toContain("text-bg");
  });

  it("destructive hover fill uses the white destructive foreground, not text-bg", () => {
    const cls = classes(renderToStaticMarkup(<Button variant="destructive">Delete</Button>));
    expect(cls).toContain("hover:text-destructive-foreground");
    expect(cls).not.toContain("hover:text-bg");
  });

  it("primary and destructive foregrounds are literal white in tailwind.config.ts", () => {
    const config = readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8");
    const white = /foreground: "rgb\(255 255 255 \/ <alpha-value>\)"/g;
    expect(config.match(white)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
