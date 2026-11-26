import { describe, expect, it } from "vitest";
import { blocksToText, parseMaintenanceRequest, titleFromIssue } from "./parse-request";

const POST = [
  "A maintenance request has been submitted -",
  "",
  "*Describe the issue or maintenance request*",
  "No hot water for couple weeks ",
  "*Location*",
  "A6",
  "*Thanks for submitting your request. Maintenance will be notified.*",
  "<@U08ER08KV7U>",
  "*What is your name?*",
  "<@U0ACQAX4K4P>",
].join("\n");

describe("parseMaintenanceRequest", () => {
  it("reads issue, location and who asked", () => {
    expect(parseMaintenanceRequest(POST)).toEqual({
      issue: "No hot water for couple weeks",
      location: "A6",
      requesterSlackId: "U0ACQAX4K4P",
      requesterName: null,
    });
  });

  it("keeps a labelled mention's name and multi-line issues", () => {
    const p = parseMaintenanceRequest(
      "*Describe the issue or maintenance request*\nTap leaks\nat the base\n*Location*\nOG kitchen\n*What is your name?*\n<@U1ABC|Ana Pires>"
    );
    expect(p).toMatchObject({
      issue: "Tap leaks\nat the base",
      location: "OG kitchen",
      requesterSlackId: "U1ABC",
      requesterName: "Ana Pires",
    });
  });

  it("takes a typed name when there is no mention", () => {
    expect(parseMaintenanceRequest("*Describe the issue*\nBroken\n*What is your name?*\nJo")?.requesterName).toBe("Jo");
  });

  it("ignores anything that is not a request", () => {
    expect(parseMaintenanceRequest("Hi, we just lost power in A6.")).toBeNull();
    expect(parseMaintenanceRequest("")).toBeNull();
  });
});

describe("blocksToText", () => {
  it("rebuilds the post from rich text blocks", () => {
    const blocks = [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: "Describe the issue or maintenance request", style: { bold: true } },
              { type: "text", text: "\nCurtain rod is falling down\n" },
              { type: "text", text: "Location", style: { bold: true } },
              { type: "text", text: "\nG4\n" },
              { type: "text", text: "What is your name?", style: { bold: true } },
              { type: "text", text: "\n" },
              { type: "user", user_id: "U0AM3RWQ4H5" },
            ],
          },
        ],
      },
    ];
    expect(parseMaintenanceRequest(blocksToText(blocks))).toMatchObject({
      issue: "Curtain rod is falling down",
      location: "G4",
      requesterSlackId: "U0AM3RWQ4H5",
    });
  });
});

describe("titleFromIssue", () => {
  it("uses the first line and trims long text", () => {
    expect(titleFromIssue("Toilet leaking\nfor weeks")).toBe("Toilet leaking");
    expect(titleFromIssue("x".repeat(100))).toHaveLength(80);
  });
});
