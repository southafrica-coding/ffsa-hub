import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminError from "./error";

describe("admin error boundary", () => {
  it("shows generic copy and retries without the error text", () => {
    const reset = vi.fn();
    const markup = renderToStaticMarkup(
      <AdminError error={Object.assign(new Error("relation staff_ministries does not exist"), { digest: "abc" })} reset={reset} />
    );
    expect(markup).toContain("This page did not load.");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("staff_ministries");
    expect(markup).not.toContain("abc");
    expect(markup).not.toContain("digest");
  });
});
