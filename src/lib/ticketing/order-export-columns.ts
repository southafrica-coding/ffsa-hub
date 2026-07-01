// Column registry for the event Orders CSV export. Shared by the export API
// route (which builds the CSV) and the Orders tab (which renders the column
// picker), so the two can never drift.

export type OrderExportColumnKey =
  | "order_id"
  | "reference"
  | "status"
  | "buyer_first_name"
  | "buyer_last_name"
  | "buyer_email"
  | "buyer_phone"
  | "subtotal"
  | "discount"
  | "donation"
  | "total"
  | "refunded"
  | "tickets"
  | "payment_provider"
  | "provider_reference"
  | "promo_code"
  | "marketing_consent"
  | "created_at"
  | "paid_at"
  | "refunded_at"
  | "cancelled_at"
  | "staff_notes";

// Canonical CSV column order — also the default emitted when nothing is
// deselected, so an un-customized download is stable.
export const ORDER_EXPORT_COLUMN_ORDER: OrderExportColumnKey[] = [
  "order_id",
  "reference",
  "status",
  "buyer_first_name",
  "buyer_last_name",
  "buyer_email",
  "buyer_phone",
  "subtotal",
  "discount",
  "donation",
  "total",
  "refunded",
  "tickets",
  "payment_provider",
  "provider_reference",
  "promo_code",
  "marketing_consent",
  "created_at",
  "paid_at",
  "refunded_at",
  "cancelled_at",
  "staff_notes",
];

export const ORDER_EXPORT_COLUMN_LABELS: Record<OrderExportColumnKey, string> = {
  order_id: "Order ID",
  reference: "Reference",
  status: "Status",
  buyer_first_name: "First Name",
  buyer_last_name: "Last Name",
  buyer_email: "Email",
  buyer_phone: "Phone",
  subtotal: "Subtotal",
  discount: "Discount",
  donation: "Donation",
  total: "Total",
  refunded: "Refunded",
  tickets: "Tickets",
  payment_provider: "Payment Provider",
  provider_reference: "Provider Reference",
  promo_code: "Promo Code",
  marketing_consent: "Marketing Consent",
  created_at: "Created At",
  paid_at: "Paid At",
  refunded_at: "Refunded At",
  cancelled_at: "Cancelled At",
  staff_notes: "Staff Notes",
};

// Grouping for the column-picker UI. (CSV order stays ORDER_EXPORT_COLUMN_ORDER.)
export const ORDER_EXPORT_COLUMN_GROUPS: {
  group: string;
  keys: OrderExportColumnKey[];
}[] = [
  { group: "Order", keys: ["order_id", "reference", "status"] },
  {
    group: "Buyer",
    keys: [
      "buyer_first_name",
      "buyer_last_name",
      "buyer_email",
      "buyer_phone",
    ],
  },
  {
    group: "Amounts (in Rand)",
    keys: ["subtotal", "discount", "donation", "total", "refunded"],
  },
  { group: "Tickets", keys: ["tickets"] },
  {
    group: "Payment",
    keys: [
      "payment_provider",
      "provider_reference",
      "promo_code",
      "marketing_consent",
    ],
  },
  {
    group: "Dates",
    keys: ["created_at", "paid_at", "refunded_at", "cancelled_at"],
  },
  { group: "Extra", keys: ["staff_notes"] },
];

const KEY_SET = new Set<string>(ORDER_EXPORT_COLUMN_ORDER);

export function isOrderExportColumnKey(s: string): s is OrderExportColumnKey {
  return KEY_SET.has(s);
}

// Parse the ?columns= query param (comma-separated keys), returning the
// selected keys in canonical order. Null / empty / all-invalid → every column
// (so old links and "select everything" both yield the full CSV).
export function parseOrderExportColumns(
  param: string | null
): OrderExportColumnKey[] {
  if (!param) return [...ORDER_EXPORT_COLUMN_ORDER];
  const requested = new Set(
    param
      .split(",")
      .map((s) => s.trim())
      .filter(isOrderExportColumnKey)
  );
  if (requested.size === 0) return [...ORDER_EXPORT_COLUMN_ORDER];
  return ORDER_EXPORT_COLUMN_ORDER.filter((k) => requested.has(k));
}
