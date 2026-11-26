// Store switches. Both default OFF so a preview deployment (which shares
// the production database) can't take money or send mail by accident.

/** Checkout (PayFast sandbox + EFT) is open only when STORE_PAYMENTS_ENABLED=1. */
export function storePaymentsEnabled(): boolean {
  return process.env.STORE_PAYMENTS_ENABLED === "1";
}

/** Store emails go out only when STORE_EMAILS_ENABLED=1; otherwise they're logged. */
export function storeEmailsEnabled(): boolean {
  return process.env.STORE_EMAILS_ENABLED === "1";
}

/** PayFast must stay in sandbox for the Store until someone decides otherwise. */
export function storePayfastIsSandbox(): boolean {
  return process.env.PAYFAST_MODE !== "live";
}

/** Max active reading devices per buyer. */
export const STORE_DEVICE_LIMIT = 3;

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
