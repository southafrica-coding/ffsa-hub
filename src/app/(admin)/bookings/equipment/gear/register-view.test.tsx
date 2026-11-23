import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegisterView, type RegisterProduct, type RegisterUnit } from "./register-view";

function unit(tag: string): RegisterUnit {
  return {
    tag,
    label: null,
    serial: "n/a",
    serialMissing: false,
    condition: "Good",
    conditionTone: "plain",
    status: "available",
    checked: "12 Mar 2026",
    checkedMissing: false,
    ownerLabel: null,
    locationId: "aud",
    location: "Auditorium",
    unverified: false,
  };
}

const products: RegisterProduct[] = [
  {
    id: "printer",
    name: "Printer",
    make: "HP · Officejet Pro",
    category: "auxiliary",
    total: 1,
    bookable: 1,
    out: 0,
    attention: "",
    needsAttention: false,
    checked: "12 Mar 2026",
    checkedIncomplete: false,
    listed: true,
    tracking: "tagged",
    counted: null,
    requestable: false,
    units: [unit("PRT-0001")],
  },
  {
    id: "elgato",
    name: "Streaming USB controller",
    make: "Elgato · 20GAI9901",
    category: "visual",
    total: 1,
    bookable: 0,
    out: 1,
    attention: "Spare USB lead is in the upstairs cupboard",
    needsAttention: true,
    checked: "Never",
    checkedIncomplete: true,
    listed: true,
    tracking: "tagged",
    counted: null,
    requestable: false,
    units: [unit("ELG-0001")],
  },
];

function markup() {
  return renderToStaticMarkup(
    createElement(RegisterView, {
      context: "Equipment",
      products,
      unitTotal: 2,
      maintenanceTotal: 0,
      locations: [{ key: "aud", label: "Auditorium", n: 2 }],
      initialOpenId: null,
      canAdd: false,
    })
  );
}

function classFor(html: string, title: string) {
  const match = html.match(new RegExp(`class="([^"]*)"[^>]*title="${title}"`));
  return match?.[1] ?? "";
}

describe("gear register rows", () => {
  it("keeps names, the category label, and quantities in separate cells", () => {
    const html = markup();

    // The product track used to be minmax(0, 1fr). With the hire shell beside
    // it that track computed to 0px, so the name, AUXILIARY, and the first
    // quantity all painted from the same x.
    expect(html).toContain("md:grid-cols-[28px_minmax(140px,1.6fr)");
    expect(html).not.toContain("md:grid-cols-[28px_minmax(0,1fr)");

    const name = classFor(html, "Streaming USB controller");
    expect(name).toMatch(/\bmin-w-0\b/);
    expect(name).toMatch(/\bbreak-words\b/);
    expect(name).not.toMatch(/\btruncate\b/);
    expect(name).not.toMatch(/\babsolute\b/);

    const category = html.match(/class="([^"]*)"[^>]*>auxiliary<\/span>/);
    expect(category?.[1] ?? "").toMatch(/\boverflow-hidden\b/);
    expect(category?.[1] ?? "").not.toMatch(/\babsolute\b/);

    // Both quantity cells are right-aligned tabular figures. The second one
    // stays amber when it is lower than the first.
    const quantities = [...html.matchAll(/class="([^"]*hire-display[^"]*)"/g)].map((m) => m[1]);
    const rowQuantities = quantities.filter((c) => c.includes("text-[22px]"));
    expect(rowQuantities.length).toBeGreaterThanOrEqual(2);
    for (const c of rowQuantities) {
      expect(c).toMatch(/\btext-right\b/);
      expect(c).toMatch(/\btabular-nums\b/);
    }
    expect(rowQuantities.some((c) => c.includes("!text-[color:var(--hire-accent)]"))).toBe(true);
  });
});
