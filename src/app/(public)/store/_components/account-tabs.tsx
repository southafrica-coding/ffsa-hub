import Link from "next/link";
import { cn } from "@/lib/utils/cn";

// My Library / Orders / Devices — the buyer's three places.
export function AccountTabs({ active, email }: { active: "library" | "orders" | "devices"; email: string }) {
  const tabs = [
    { id: "library", href: "/store/library", label: "Library" },
    { id: "orders", href: "/store/orders", label: "Orders" },
    { id: "devices", href: "/store/library/devices", label: "Devices" },
  ] as const;
  return (
    <div className="border-b border-ink px-4 pt-8 md:px-8 md:pt-12">
      <div className="masthead-context">Signed in as {email}</div>
      <h1 className="masthead-title">My {active === "library" ? "Library" : active === "orders" ? "Orders" : "Devices"}</h1>
      <nav className="-mb-px mt-5 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={cn(
              "inline-flex min-h-11 items-center border border-b-0 px-4 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors",
              active === t.id ? "border-ink bg-ink text-white" : "border-transparent text-[color:var(--text-tertiary)] hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        ))}
        <form action="/store/auth/sign-out" method="post" className="ml-auto">
          <button className="inline-flex min-h-11 items-center px-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] hover:text-ink">Sign out</button>
        </form>
      </nav>
    </div>
  );
}
