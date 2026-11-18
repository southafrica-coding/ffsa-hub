import { describe, expect, it } from "vitest";
import {
  CONFIRM_MATCH_FN,
  connectCardLink,
  pendingItemKey,
  pendingSuggestion,
  suggestedContactLabel,
} from "@/lib/missio/pending-match";

const JANE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CARD = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

describe("pending phone match", () => {
  it("stores a phone match as pending_confirm and does not attach it", () => {
    const link = connectCardLink({ by: "phone", contactId: JANE });
    expect(link).toEqual({
      matched_contact_id: null,
      match_status: "pending_confirm",
      suggested_contact_id: JANE,
    });
    expect(link).not.toHaveProperty("phone");
    expect(link).not.toHaveProperty("email");
    expect(CONFIRM_MATCH_FN).toBe("link_missio_connect_match");
  });

  it("still attaches an email or name match, and leaves a miss unmatched", () => {
    expect(connectCardLink({ by: "email", contactId: JANE })).toEqual({ matched_contact_id: JANE });
    expect(connectCardLink({ by: "name", contactId: JANE })).toEqual({ matched_contact_id: JANE });
    expect(connectCardLink({ by: "none" })).toEqual({ matched_contact_id: null });
    expect(connectCardLink({ by: "none" })).not.toHaveProperty("match_status");
  });

  it("reads a pending suggestion and keeps the card on an r_ key", () => {
    expect(pendingSuggestion({ match_status: "pending_confirm", suggested_contact_id: JANE })).toBe(JANE);
    expect(pendingSuggestion({ match_status: "confirmed", suggested_contact_id: JANE })).toBeNull();
    expect(pendingSuggestion({ match_status: "unmatched", suggested_contact_id: null })).toBeNull();
    expect(pendingItemKey(CARD)).toBe(`r_${CARD}`);
  });

  it("puts the contact id and a display name on the suggestion, and nothing else", () => {
    expect(suggestedContactLabel(JANE, "Jane Doe")).toEqual({ contactId: JANE, displayName: "Jane Doe" });
    expect(Object.keys(suggestedContactLabel(JANE, "Jane Doe"))).toEqual(["contactId", "displayName"]);
    expect(suggestedContactLabel(JANE, "  ")).toEqual({ contactId: JANE, displayName: "" });
  });
});
