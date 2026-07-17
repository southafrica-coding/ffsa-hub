import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMinistries } from "@/services/ministries";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { NewMinistryButton } from "./new-ministry-button";
import { Badge } from "@/components/ui/badge";

export default async function MinistryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isAdmin = await callerIsAdmin(supabase, user.id);
  const ledIds = isAdmin ? [] : await getLedMinistryIds(supabase, user.id);
  if (!isAdmin && ledIds.length === 0) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: ministries } = await listMinistries(admin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visible = ((ministries ?? []) as any[]).filter(
    (m) => isAdmin || ledIds.includes(m.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="page-eyebrow">PEOPLE</p>
          <h1 className="page-title">Ministries</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {visible.length} ministr{visible.length === 1 ? "y" : "ies"}
            {!isAdmin && " you lead"}
          </p>
        </div>
        {isAdmin && <NewMinistryButton />}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ministries yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => {
            const count = m.ministry_memberships?.[0]?.count ?? 0;
            return (
              <Link
                key={m.id}
                href={`/ministry/${m.id}`}
                className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-foreground">{m.name}</h2>
                  {!m.is_active && <Badge variant="outline">Retired</Badge>}
                </div>
                {m.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {m.description}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {count} {count === 1 ? "person" : "people"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
