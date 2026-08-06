import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageComms } from "@/lib/api-auth";
import { listSendingIdentities } from "@/services/campaigns";
import { getBrandKit, mergeBrand, type BrandKitRow } from "@/services/brand";
import { BrandEditor } from "./brand-editor";

export const dynamic = "force-dynamic";

export default async function BrandSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ identity?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (
    !(await canManageComms(supabase, user.id, [
      "communications.manage_brand_kits",
    ]))
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const { data: identities } = await listSendingIdentities(supabase);
  const list = (identities ?? []) as {
    id: string;
    slug: string;
    display_name: string;
    from_email: string;
    from_name: string;
    provider: string;
  }[];

  const selectedId = params.identity && list.some((i) => i.id === params.identity)
    ? params.identity
    : list[0]?.id;

  const brandRow: BrandKitRow | null = selectedId
    ? await getBrandKit(supabase, selectedId)
    : null;
  const effective = mergeBrand(brandRow);

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">COMMUNICATIONS</p>
        <h1 className="page-title">Brand kits</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Each sending identity has its own brand kit. Anything left blank
          falls back to a clean editorial default.
        </p>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sending identities configured. Add one first under
          Communications settings.
        </p>
      ) : (
        <BrandEditor
          identities={list}
          selectedIdentityId={selectedId!}
          initialBrand={brandRow}
          initialEffective={effective}
        />
      )}
    </div>
  );
}
