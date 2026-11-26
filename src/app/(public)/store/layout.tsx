// The Hub Store's public chrome: white page, black hairlines, the FF
// wordmark — the signed-out look of /login, not the admin shell and not the
// dark /hire storefront. Buyers never see staff navigation.

import type { Metadata } from "next";
import { StoreHeader } from "./_components/store-header";

export const metadata: Metadata = {
  title: { default: "Store · Fire & Fragrance", template: "%s · Fire & Fragrance Store" },
  description: "Reviews, books and merch from Fire & Fragrance South Africa. Read in your browser, or have it delivered.",
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] overflow-x-clip bg-white text-ink">
      <StoreHeader />
      <main className="mx-auto max-w-6xl animate-fade-up pb-20">{children}</main>
      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] md:flex-row md:justify-between md:px-8">
          <span>Fire &amp; Fragrance South Africa</span>
          <span>Prices in rand · Card or EFT</span>
        </div>
      </footer>
    </div>
  );
}
