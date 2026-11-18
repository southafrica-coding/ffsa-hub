import { describe, expect, it } from "vitest";
import {
  CONFIRM_MATCH_RPC,
  PENDING_MATCH,
  confirmMatchRpcArgs,
  connectCardLink,
  pendingItemKey,
  pendingSelectColumns,
  readPendingContactId,
  suggestedContactLabel,
  type PendingMatchContract,
} from "@/lib/missio/pending-match";

const JANE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CARD = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

/** Stand-in names. These are not the schema. They prove the plug-in point. */
const SAMPLE: PendingMatchContract = {
  statusColumn: "plug_status",
  needsConfirmStatus: "plug_needs_confirm",
  suggestedContactColumn: "plug_suggested_contact",
  cardIdParam: "plug_card_id",
  contactIdParam: "plug_contact_id",
};

describe("pending phone match", () => {
  it("leaves the contract empty until Hub Data names the columns", () => {
    expect(PENDING_MATCH).toBeNull();
    expect(pendingSelectColumns()).toBeNull();
    expect(CONFIRM_MATCH_RPC).toBe("link_missio_connect_match");
  });

  it("still attaches a phone match while the column names are unknown", () => {
    expect(connectCardLink({ by: "phone", contactId: JANE })).toEqual({ matched_contact_id: JANE });
    expect(connectCardLink({ by: "email", contactId: JANE })).toEqual({ matched_contact_id: JANE });
    expect(connectCardLink({ by: "name", contactId: JANE })).toEqual({ matched_contact_id: JANE });
    expect(connectCardLink({ by: "none" })).toEqual({ matched_contact_id: null });
  });

  it("stores a phone match as pending and does not attach once the names are filled in", () => {
    const link = connectCardLink({ by: "phone", contactId: JANE }, SAMPLE);
    expect(link).toEqual({
      matched_contact_id: null,
      plug_status: "plug_needs_confirm",
      plug_suggested_contact: JANE,
    });
    expect(link).not.toHaveProperty("phone");
    expect(link).not.toHaveProperty("email");
    expect(connectCardLink({ by: "email", contactId: JANE }, SAMPLE)).toEqual({ matched_contact_id: JANE });
    expect(connectCardLink({ by: "none" }, SAMPLE)).toEqual({ matched_contact_id: null });
  });

  it("reads the suggestion from the plugged-in columns and keeps the card on an r_ key", () => {
    expect(readPendingContactId({ plug_status: "plug_needs_confirm", plug_suggested_contact: JANE }, SAMPLE)).toBe(JANE);
    expect(readPendingContactId({ plug_status: "other", plug_suggested_contact: JANE }, SAMPLE)).toBeNull();
    expect(readPendingContactId({ phone: "+27821234567", email: "jane@example.com" })).toBeNull();
    expect(pendingItemKey(CARD)).toBe(`r_${CARD}`);
    expect(pendingItemKey(CARD)).not.toBe(`c_${JANE}`);
  });

  it("puts only a display name on the suggestion", () => {
    expect(suggestedContactLabel("Jane Doe")).toEqual({ displayName: "Jane Doe" });
    expect(Object.keys(suggestedContactLabel("Jane Doe") ?? {})).toEqual(["displayName"]);
    expect(suggestedContactLabel("  ")).toBeNull();
    expect(suggestedContactLabel(null)).toBeNull();
  });

  it("builds the RPC arguments from the plugged-in parameter names", () => {
    expect(confirmMatchRpcArgs(SAMPLE, CARD, JANE)).toEqual({
      plug_card_id: CARD,
      plug_contact_id: JANE,
    });
  });
});
