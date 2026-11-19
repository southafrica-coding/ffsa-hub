import { describe, expect, it } from "vitest";
import { plainForSpeech, spokenCommand } from "./speech";

describe("plainForSpeech", () => {
  it("drops markdown, links and ids, and says dates and money the way people do", () => {
    const s = plainForSpeech(
      "Your **PBO approval** runs out on 2027-02-28.\n\n- Fee: R 1,250.00\n- Draft saved: /legal-documents?draft=6f1c2a3b-1111-4222-8333-444455556666 → Drafts"
    );
    expect(s).toBe("Your PBO approval runs out on 28 February 2027. Fee: 1,250 rand. Draft saved:, then Drafts");
  });
  it("keeps long answers short and points at the screen", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const s = plainForSpeech(long, 200);
    expect(s.length).toBeLessThan(240);
    expect(s.endsWith("The rest is on the screen.")).toBe(true);
    expect(s).toMatch(/is here\. The rest/);
  });
});

describe("spokenCommand", () => {
  it("hears stop phrases", () => {
    for (const t of ["Stop", "stop listening.", "That's all", "thats all thanks", "Goodbye!"]) expect(spokenCommand(t)).toBe("stop");
  });
  it("hears a background hand-off", () => {
    expect(spokenCommand("Prepare the PBO renewal pack in the background")).toBe("background");
  });
  it("leaves everything else alone", () => {
    expect(spokenCommand("When does the lease stop?")).toBeNull();
    expect(spokenCommand("Stop the renewal reminder for the lease")).toBeNull();
  });
});
