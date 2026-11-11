import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildShellNav } from "@/components/shell-nav";
import PrayerRoomChrome from "./chrome";

describe("Prayer room masthead", () => {
  it("uses the shell nav label, Prayer room", () => {
    const shellLabel = buildShellNav(["member"]).services.find((item) => item.href === "/prayer-room")?.label;
    expect(shellLabel).toBe("Prayer room");

    const html = renderToStaticMarkup(
      <PrayerRoomChrome
        context="This week"
        tabs={[{ key: "week", label: "Week" }]}
        active="week"
        onChange={() => {}}
      />
    );

    expect(html).toContain("Prayer room");
    expect(html).not.toContain("Prayer Room");
  });
});
