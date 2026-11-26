import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { STORE_DEVICE_LIMIT } from "@/lib/store/flags";
import type { StoreDevice } from "@/lib/store/types";
import { listDevices } from "@/services/store";
import { AccountTabs } from "../../_components/account-tabs";
import { DeviceList } from "./device-list";

export const metadata: Metadata = { title: "Devices" };
export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) redirect("/store/library");
  const { data } = await listDevices(supabase, buyer.userId);
  const devices = (data ?? []) as StoreDevice[];
  return (
    <>
      <AccountTabs active="devices" email={buyer.email} />
      <div className="px-4 pt-6 md:px-8">
        <p className="max-w-[560px] text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          You can read on {STORE_DEVICE_LIMIT} devices at a time. Remove one you don&apos;t use any more to read somewhere new.
        </p>
        <DeviceList devices={devices.map((d) => ({ id: d.id, label: d.label, lastSeen: d.last_seen_at }))} limit={STORE_DEVICE_LIMIT} />
      </div>
    </>
  );
}
