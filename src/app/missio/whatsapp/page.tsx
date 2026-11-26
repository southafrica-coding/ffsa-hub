import type { Metadata } from "next";
import { Suspense } from "react";
import { MissioWhatsApp } from "@/components/missio/whatsapp/missio-whatsapp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "WhatsApp · Missio" },
};

// ?person=<id> or ?thread=<id> opens one conversation (read on the client).
export default function MissioWhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <MissioWhatsApp />
    </Suspense>
  );
}
