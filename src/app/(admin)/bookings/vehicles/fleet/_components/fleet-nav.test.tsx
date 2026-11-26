import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/bookings/vehicles/fleet" }));
import { FleetNav } from "./fleet-nav";

// Jack's review of #698: Calendar opens the booking board, which only the vehicles team
// may open, so a Fleet view-only user doesn't get the tab.
describe("FleetNav", () => {
  it("shows Calendar to the vehicles team", () => {
    expect(renderToStaticMarkup(<FleetNav calendar />)).toContain(">Calendar<");
  });
  it("hides it from people who can't open the booking board", () => {
    const html = renderToStaticMarkup(<FleetNav calendar={false} />);
    expect(html).not.toContain("Calendar");
    expect(html).toContain(">Today<");
  });
});
