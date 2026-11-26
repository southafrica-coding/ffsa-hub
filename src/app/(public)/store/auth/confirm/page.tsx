"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "../../_components/ui";

// The buyer's sign-in link lands here. The one-time token is verified in
// the browser, so an email scanner fetching the link can't use it up.
export default function StoreAuthConfirm() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get("token_hash");
    const next = q.get("next") ?? "/store/library";
    const safeNext = /^\/store(\/[A-Za-z0-9/_-]*)?$/.test(next) ? next : "/store/library";
    if (!tokenHash) return setFailed(true);
    createClient()
      .auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" })
      .then(({ error }) => {
        if (error) setFailed(true);
        else router.replace(safeNext);
      });
  }, [router]);

  return (
    <div className="mx-auto max-w-[440px] px-4 pt-16">
      <div className="masthead-context">My Library</div>
      <h1 className="masthead-title">{failed ? "That link has expired" : "Signing you in"}</h1>
      <div className="mt-6">
        {failed ? (
          <Notice>
            Sign-in links work once and last an hour.{" "}
            <Link href="/store/library" className="font-semibold underline decoration-yellow decoration-2 underline-offset-4">
              Send a new one
            </Link>
            .
          </Notice>
        ) : (
          <div className="h-1 w-full overflow-hidden bg-bone-2"><div className="h-full w-1/3 animate-pulse bg-ink" /></div>
        )}
      </div>
    </div>
  );
}
