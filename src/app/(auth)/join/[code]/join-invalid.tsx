import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthShell } from "../../auth-shell";

export function JoinInvalid() {
  return (
    <AuthShell>
      <div className="masthead-context">Link expired</div>
      <h1 className="page-title">This invite link isn&apos;t active</h1>

      <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
        It may have been regenerated or paused by a super admin. Ask whoever shared
        this link for an updated one, or sign in if you already have an account.
      </p>

      <div className="mt-9 border-t border-rule pt-6">
        <Button asChild className="h-12 w-full sm:w-auto sm:px-10">
          <Link href="/login">Go to Login</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
