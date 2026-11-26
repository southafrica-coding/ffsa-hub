import type { Metadata } from "next";
import { ConnectForm } from "@/components/missio/connect/connect-form";
import { missioBody, missioDisplay } from "@/components/missio/fonts";

export const metadata: Metadata = {
  title: { absolute: "Connect · Missio" },
  robots: { index: false, follow: false },
};

export default function ConnectMissioPage() {
  return (
    <div data-missio-font="" className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className}`}>
      <ConnectForm />
    </div>
  );
}
