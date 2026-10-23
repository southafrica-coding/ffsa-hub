import { describe, expect, it } from "vitest";
import {
  amountLine,
  buildProposal,
  currencyMenu,
  duplicateWarning,
  fileKind,
  fmtNum,
  logButtonText,
  missingForLog,
  parseChange,
  parseTeamOption,
  parseTypedAmount,
  pickCategory,
  pickCurrency,
  pickDate,
  rateFromCash,
  rateFromLive,
  receiptCardBlocks,
  safeFileName,
  teamOptionValue,
  toZar,
  type ReceiptReading,
} from "./receipt-logic";

const CATS = ["Food", "Transport", "Accommodation", "Airport Meals", "Gifts"].map((name, i) => ({
  id: `c${i}`,
  name,
  slug: name.toLowerCase().replace(/ /g, "-"),
  sort_order: i,
}));
const TODAY = "2026-10-22";

const reading = (over: Partial<ReceiptReading> = {}): ReceiptReading => ({
  document_kind: "receipt",
  is_receipt: true,
  legibility: "clear",
  vendor: "Choppies",
  date: "2026-10-22",
  total: 342.5,
  currency: "BWP",
  vat_amount: null,
  receipt_number: "0042",
  summary: "Groceries",
  suggested_category: "Food",
  paid_by: "cash",
  notes: null,
  bank_zar_total: null,
  bank_zar_fee: null,
  bank_foreign_amount: null,
  bank_foreign_currency: null,
  ...over,
});

const BATCHES = [
  { id: "b1", batch_date: "2026-10-10", local_currency: "BWP", exchange_rate: 0.7 },
  { id: "b2", batch_date: "2026-10-20", local_currency: "BWP", exchange_rate: "0.752582" },
];

describe("files", () => {
  it("knows photos, PDFs and everything else", () => {
    expect(fileKind({ id: "1", mimetype: "image/jpeg" })).toBe("image");
    expect(fileKind({ id: "1", mimetype: "image/heic", filetype: "heic" })).toBe("image");
    expect(fileKind({ id: "1", mimetype: "application/pdf" })).toBe("pdf");
    expect(fileKind({ id: "1", mimetype: "application/vnd.ms-excel", filetype: "xls" })).toBe("unsupported");
  });

  it("makes storage-safe names that still read like the original", () => {
    expect(safeFileName({ id: "1", name: "IMG 2041 (1).HEIC" })).toBe("IMG_2041_1_.HEIC");
    expect(safeFileName({ id: "1", filetype: "jpg" })).toBe("receipt.jpg");
  });
});

describe("exchange rate", () => {
  it("needs no rate for rand", () => {
    expect(rateFromCash("ZAR", BATCHES)).toMatchObject({ exchange_rate: 1, source: "same_currency" });
  });

  it("uses the team's most recent cash withdrawal in that currency", () => {
    const r = rateFromCash("BWP", BATCHES)!;
    expect(r).toMatchObject({ exchange_rate: 0.752582, source: "cash_batch", cash_batch_id: "b2" });
    expect(r.label).toContain("20 Oct");
  });

  it("returns null when the team has no cash in that currency", () => {
    expect(rateFromCash("USD", BATCHES)).toBeNull();
  });

  it("flips a live 'rand per unit' rate into the Hub's 'units per rand'", () => {
    const r = rateFromLive("BWP", 1.33, TODAY);
    expect(r.exchange_rate).toBeCloseTo(1 / 1.33, 6);
    expect(toZar(342.5, r.exchange_rate)).toBe(455.53);
  });

  it("converts like the Hub's expense form (local ÷ rate)", () => {
    expect(toZar(342.5, 0.752582)).toBe(455.1);
  });
});

describe("pickers", () => {
  it("prefers what the person typed over what was read", () => {
    expect(pickCategory("this is for transport", "Food", CATS)?.name).toBe("Transport");
    expect(pickCategory("gas", "Food", CATS)?.name).toBe("Transport");
    expect(pickCategory(null, "Food", CATS)?.name).toBe("Food");
    expect(pickCategory("thanks!", null, CATS)).toBeNull();
  });

  it("falls back from an unknown currency to the team's cash, then rand", () => {
    expect(pickCurrency("bwp", null)).toBe("BWP");
    expect(pickCurrency("XYZ", "BWP")).toBe("BWP");
    expect(pickCurrency(null, null)).toBe("ZAR");
  });

  it("keeps a sensible receipt date and flags odd ones", () => {
    expect(pickDate("2026-10-21", TODAY)).toEqual({ date: "2026-10-21", warning: null });
    expect(pickDate(null, TODAY).date).toBe(TODAY);
    expect(pickDate("2026-11-30", TODAY)).toMatchObject({ date: TODAY });
    expect(pickDate("2024-01-01", TODAY).warning).toMatch(/over a year/);
  });
});

describe("buildProposal", () => {
  it("turns a clear foreign receipt into a ready-to-log expense", () => {
    const { proposal, warnings } = buildProposal({
      reading: reading(),
      userNote: null,
      categories: CATS,
      currency: "BWP",
      rate: rateFromCash("BWP", BATCHES),
      today: TODAY,
    });
    expect(proposal).toMatchObject({
      category_id: "c0",
      vendor: "Choppies",
      expense_date: "2026-10-22",
      local_currency: "BWP",
      local_amount: 342.5,
      zar_amount: 455.1,
      cash_batch_id: "b2",
      payment_method: "cash",
      receipt_code: "0042",
    });
    expect(warnings).toEqual([]);
    expect(missingForLog(proposal)).toEqual([]);
  });

  it("says what's missing instead of guessing", () => {
    const { proposal, warnings } = buildProposal({
      reading: reading({ total: null, suggested_category: null, legibility: "partial" }),
      userNote: null,
      categories: CATS,
      currency: "USD",
      rate: null,
      today: TODAY,
    });
    expect(missingForLog(proposal)).toEqual(["a category", "the amount", "the rand amount / exchange rate"]);
    expect(warnings.join(" ")).toMatch(/category/);
    expect(warnings.join(" ")).toMatch(/total/);
    expect(warnings.join(" ")).toMatch(/hard to read/);
  });

  it("marks a card slip as paid by card", () => {
    const { proposal } = buildProposal({
      reading: reading({ paid_by: "card", currency: "ZAR" }),
      userNote: null,
      categories: CATS,
      currency: "ZAR",
      rate: rateFromCash("ZAR", []),
      today: TODAY,
    });
    expect(proposal).toMatchObject({ payment_method: "card", zar_amount: 342.5, exchange_rate: 1 });
  });
});

describe("duplicateWarning", () => {
  const p = { vendor: "Choppies", expense_date: "2026-10-22", zar_amount: 455.1 };

  it("catches the same photo sent twice", () => {
    expect(duplicateWarning("abc", p, [{ file_sha256: "abc", status: "logged" }])).toMatch(/exact photo/);
  });

  it("ignores a photo whose earlier copy was cancelled", () => {
    expect(duplicateWarning("abc", p, [{ file_sha256: "abc", status: "cancelled" }])).toBeNull();
  });

  it("catches the same shop, day and amount already logged", () => {
    expect(
      duplicateWarning("new", p, [{ vendor: "choppies ", expense_date: "2026-10-22", zar_amount: "455.10" }])
    ).toMatch(/same amount/);
    expect(duplicateWarning("new", p, [{ vendor: "Choppies", expense_date: "2026-10-21", zar_amount: 455.1 }])).toBeNull();
  });
});

describe("Slack card", () => {
  const { proposal } = buildProposal({
    reading: reading(),
    userNote: null,
    categories: CATS,
    currency: "BWP",
    rate: rateFromCash("BWP", BATCHES),
    today: TODAY,
  });

  it("formats money the same on any server", () => {
    expect(fmtNum(22800.5)).toBe("22 800.50");
    expect(fmtNum(455.1)).toBe("455.10");
    expect(amountLine(proposal)).toBe("P 342.50 → *R455.10* (your cash rate from 20 Oct: R1.33 per BWP)");
    // Weak currencies read as units per rand, not "R0.01 per BIF".
    expect(amountLine({ ...proposal, local_currency: "BIF", local_amount: 45000, exchange_rate: 178.0436563, zar_amount: 252.75 })).toBe(
      "FBu 45 000.00 → *R252.75* (your cash rate from 20 Oct: 178.04 BIF per R1)"
    );
  });

  it("carries the draft id on all three buttons", () => {
    const blocks = receiptCardBlocks({ draftId: "d1", senderName: "Ana", proposal, categoryName: "Food", warnings: [], team: null });
    const actions = blocks.find((b) => (b as { type: string }).type === "actions") as {
      elements: { action_id: string; value: string }[];
    };
    expect(actions.elements.map((e) => [e.action_id, e.value])).toEqual([
      ["receipt_log", "d1"],
      ["receipt_change", "d1"],
      ["receipt_cancel", "d1"],
    ]);
  });

  const ESW = { id: "t1", name: "Eswatini Leadership Track 26'" };
  const BOTS = { id: "t2", name: "Botswana" };
  const text = (b: unknown) => JSON.stringify(b);

  it("names the team on the card and on the Log button", () => {
    const blocks = receiptCardBlocks({ draftId: "d1", senderName: "Jack", proposal, categoryName: "Food", warnings: [], team: ESW });
    expect(text(blocks[0])).toContain("for *Eswatini Leadership Track 26'*");
    const actions = blocks.find((b) => (b as { type: string }).type === "actions") as {
      elements: { text: { text: string } }[];
    };
    expect(actions.elements[0].text.text).toBe("✅ Log to Eswatini Leadership Track 26'");
  });

  it("asks which team when none is chosen, with a menu of the sender's teams", () => {
    const blocks = receiptCardBlocks({
      draftId: "d1", senderName: "Jack", proposal, categoryName: "Food", warnings: [], team: null, teamChoices: [ESW, BOTS],
    });
    expect(text(blocks[0])).toContain("which team is this for?");
    const menu = blocks.find((b) => (b as { block_id?: string }).block_id === "receipt_team:d1") as {
      accessory: { action_id: string; options: { value: string }[]; initial_option?: unknown };
    };
    expect(menu.accessory.action_id).toBe("receipt_team");
    expect(menu.accessory.options.map((o) => o.value)).toEqual(["d1|t1", "d1|t2"]);
    expect(menu.accessory.initial_option).toBeUndefined();
  });

  it("pre-selects the guessed team in the menu", () => {
    const blocks = receiptCardBlocks({
      draftId: "d1", senderName: "Jack", proposal, categoryName: "Food", warnings: [], team: BOTS, teamChoices: [ESW, BOTS],
    });
    const menu = blocks.find((b) => (b as { block_id?: string }).block_id === "receipt_team:d1") as {
      accessory: { initial_option?: { value: string } };
    };
    expect(menu.accessory.initial_option?.value).toBe("d1|t2");
  });

  it("shows no menu when there's only one team to pick", () => {
    const blocks = receiptCardBlocks({
      draftId: "d1", senderName: "Jack", proposal, categoryName: "Food", warnings: [], team: ESW, teamChoices: [ESW],
    });
    expect(blocks.some((b) => (b as { block_id?: string }).block_id === "receipt_team:d1")).toBe(false);
  });
});

describe("team menu values", () => {
  it("round-trips draft and team", () => {
    expect(parseTeamOption(teamOptionValue("d1", "t1"))).toEqual({ draftId: "d1", teamId: "t1" });
    expect(parseTeamOption("junk")).toBeNull();
    expect(parseTeamOption(undefined)).toBeNull();
  });

  it("keeps the Log button within Slack's 75 characters", () => {
    expect(logButtonText(null)).toBe("✅ Log it");
    expect(logButtonText("x".repeat(100)).length).toBeLessThanOrEqual(75);
  });
});

describe("parseChange", () => {
  const values = (over: Record<string, unknown> = {}) => ({
    vendor: { v: { value: "Choppies" } },
    date: { v: { selected_date: "2026-10-22" } },
    amount: { v: { value: "P342,50" } },
    currency: { v: { selected_option: { value: "BWP" } } },
    zar: { v: { value: "" } },
    category: { v: { selected_option: { value: "c0" } } },
    payment: { v: { selected_option: { value: "cash" } } },
    description: { v: { value: "Groceries" } },
    ...over,
  });

  it("reads a filled-in form", () => {
    const r = parseChange(values({ amount: { v: { value: "342.50" } } }));
    expect(r).toEqual({
      ok: true,
      input: {
        vendor: "Choppies",
        expense_date: "2026-10-22",
        local_amount: 342.5,
        local_currency: "BWP",
        zar_override: null,
        category_id: "c0",
        payment_method: "cash",
        description: "Groceries",
      },
    });
  });

  it("reads amounts the way people type them", () => {
    expect(parseTypedAmount("342,50")).toBe(342.5);
    expect(parseTypedAmount("P342.50")).toBe(342.5);
    expect(parseTypedAmount("R 1 200")).toBe(1200);
    expect(parseTypedAmount("1,200.50")).toBe(1200.5);
    expect(parseTypedAmount("1,200")).toBe(1200);
    expect(parseTypedAmount("abc")).toBeNull();
    const r = parseChange(values());
    expect(r.ok && r.input.local_amount).toBe(342.5);
  });

  it("takes a typed rand amount as the override", () => {
    const r = parseChange(values({ amount: { v: { value: "342.50" } }, zar: { v: { value: "R 460" } } }));
    expect(r.ok && r.input.zar_override).toBe(460);
  });

  it("returns field errors Slack can show under each box", () => {
    const r = parseChange(values({ amount: { v: { value: "" } }, category: { v: { selected_option: null } } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["amount", "category"]);
  });
});

describe("currencyMenu", () => {
  it("fits Slack's 100-option cap and leads with the receipt's currency", () => {
    const menu = currencyMenu("XOF");
    expect(menu.length).toBe(100);
    expect(menu[0].code).toBe("XOF");
    expect(menu.slice(1, 4).map((c) => c.code)).toEqual(["ZAR", "BWP", "BIF"]);
    expect(new Set(menu.map((c) => c.code)).size).toBe(100);
  });

  it("always offers the usual outreach currencies", () => {
    const codes = currencyMenu(null).map((c) => c.code);
    for (const c of ["ZMW", "SZL", "LSL", "USD"]) expect(codes).toContain(c);
  });
});
