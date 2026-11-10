"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVisiblePortalTabs } from "@/config/modules";

export function PortalNav() {
  const pathname = usePathname();

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link href="/profile" className="flex items-center gap-2 group">
          <Image
            src="/brand/ff-mark-white.png"
            alt="Fire & Fragrance"
            width={28}
            height={18}
            style={{ objectFit: "contain", display: "block" }}
            priority
          />
          <span
            className="text-[10px] font-bold uppercase text-muted-foreground"
            style={{ letterSpacing: "0.28em" }}
          >
            Hub
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {getVisiblePortalTabs().map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <tab.icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
              </Link>
            );
          })}

          <form action="/auth/sign-out" method="post">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="ml-2 gap-2 text-muted-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
