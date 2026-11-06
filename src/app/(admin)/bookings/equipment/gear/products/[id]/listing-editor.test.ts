import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href: props.href }, props.children),
}));

import { ListingEditor } from "./listing-editor";

const product = {
  id: "prod1",
  slug: "shure-sm58",
  is_listed: true,
  can_leave_building: true,
  price_day_cents: 12000,
  price_weekend_cents: null,
  price_week_cents: null,
  deposit_cents: 0,
  internal_day_cents: 0,
  description: null,
  included: [] as string[],
  specs: {} as Record<string, string>,
  store_category_id: null,
  replacement_value_cents: null,
  sortly_sid: null,
};

const photos = [
  { id: "ph1", url: "https://example.test/a.jpg" },
  { id: "ph2", url: "https://example.test/b.jpg" },
];

function html(canEdit: boolean) {
  return renderToStaticMarkup(
    React.createElement(ListingEditor, {
      canEdit,
      product,
      bookable: 1,
      photos,
      categories: [],
    })
  );
}

describe("ListingEditor photos", () => {
  it("offers replace, add, and remove to the rental manager", () => {
    const page = html(true);
    expect(page.match(/aria-label="Replace photo"/g)).toHaveLength(2);
    expect(page).toContain("Add");
    expect(page.match(/aria-label="Remove photo"/g)).toHaveLength(2);
    expect(page).toContain("https://example.test/a.jpg");
    expect(page).toContain("https://example.test/b.jpg");
  });

  it("stays read-only for everyone else", () => {
    const page = html(false);
    expect(page).not.toContain('aria-label="Replace photo"');
    expect(page).not.toContain("Add");
    expect(page).not.toContain('aria-label="Remove photo"');
    expect(page).toContain("Only the rental manager can change a listing.");
    expect(page).toContain("Replacement value");
    expect(page).toContain("https://example.test/a.jpg");
  });
});
