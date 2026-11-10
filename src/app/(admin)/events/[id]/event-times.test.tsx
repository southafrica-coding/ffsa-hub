/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CheckInTab } from "./check-in-tab";
import { OrdersTab } from "./orders-tab";

const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/New_York";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// 22:15:30 UTC is 00:15:30 the next day in Johannesburg, 17:15:30 in New York.
const PAID_AT = "2026-11-10T22:15:30.000Z";
const SAST = "2026/11/11, 00:15:30";

const checkedInTicket = {
  id: "ticket-1",
  status: "checked_in" as const,
  code: "DOOR1",
  checked_in_at: PAID_AT,
  checked_in_by: null,
  checked_in_by_name: "Door team",
  created_at: PAID_AT,
  ticket_types: { name: "General" },
  orders: {
    id: "order-1",
    buyer_first_name: "Ama",
    buyer_last_name: "Nkosi",
    buyer_email: "ama@example.com",
  },
  users: null,
};

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("event page times on first paint", () => {
  const errors: string[] = [];
  let restoreError: (() => void) | null = null;

  afterEach(() => {
    restoreError?.();
    restoreError = null;
    document.body.innerHTML = "";
  });

  function watchConsole() {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      original(...args);
    };
    restoreError = () => {
      console.error = original;
    };
  }

  it("renders the check-in roster in SAST and does not stamp Updated during render", async () => {
    errors.length = 0;
    watchConsole();

    const html = renderToString(
      <CheckInTab eventId="event-1" tickets={[checkedInTicket]} />
    );
    expect(html).toContain(SAST);
    expect(html).toContain("Updated —");
    expect(html).not.toContain("PM");
    expect(html).not.toMatch(/Updated \d/);

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);

    await act(async () => {
      hydrateRoot(host, <CheckInTab eventId="event-1" tickets={[checkedInTicket]} />);
    });

    const hydration = errors.filter((line) =>
      /hydration|did not match|didn't match|text content does not match/i.test(line)
    );
    expect(hydration).toEqual([]);
    expect(host.textContent).toMatch(/Updated \d{2}:\d{2}:\d{2}/);
    expect(host.textContent).toContain(SAST);
    expect(host.textContent).not.toContain("PM");
  });

  it("renders an order's payment time in SAST on first paint", () => {
    const html = renderToString(
      <OrdersTab
        eventId="event-1"
        currency="ZAR"
        orders={[
          {
            id: "order-1234abcd",
            status: "paid",
            buyer_first_name: "Ama",
            buyer_last_name: "Nkosi",
            buyer_email: "ama@example.com",
            total_cents: 15000,
            refund_cents: 0,
            paid_at: PAID_AT,
            created_at: PAID_AT,
            contact_resolution: "matched",
            payment_provider: "payfast",
            provider_payment_id: null,
            currency: "ZAR",
          },
        ]}
        ticketEmails={[
          {
            id: "email-1",
            order_id: "order-1234abcd",
            to_email: "ama@example.com",
            status: "delivered",
            error: null,
            sent_at: PAID_AT,
            delivered_at: PAID_AT,
            opened_at: null,
            bounced_at: null,
            complained_at: null,
            created_at: PAID_AT,
          },
        ]}
      />
    );

    expect(html).toContain(SAST);
    expect(html).not.toContain("5:15:30 PM");
  });
});
