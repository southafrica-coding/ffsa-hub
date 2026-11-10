import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("shell link colour", () => {
  it("uses zero specificity and skips classed anchors", () => {
    expect(css).toContain(":where([data-shell-main]) a:not([class])");
    expect(css).not.toMatch(/\[data-shell-main\] a \{/);
    expect(css).not.toContain("bg-ffsa-black");
  });
});
