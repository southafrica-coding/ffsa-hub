"use client";

// Opens the Hub feedback form. One component, three looks: the desktop
// rail icon, the phone top-bar icon, and a masthead button on My feedback.

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { MastheadButton } from "@/components/ffsa";
import { FeedbackDialog } from "./feedback-dialog";

export function FeedbackButton({ variant }: { variant: "rail" | "topbar" | "masthead" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "rail" && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Send Hub feedback"
          aria-label="Send Hub feedback"
          className="mb-2 flex h-[34px] w-[34px] items-center justify-center hover:bg-[#1C1C1A]"
        >
          <MessageSquarePlus className="h-[17px] w-[17px] text-[#8E8A7C]" />
        </button>
      )}
      {variant === "topbar" && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Send Hub feedback"
          className="p-2 text-white"
        >
          <MessageSquarePlus className="h-5 w-5" />
        </button>
      )}
      {variant === "masthead" && <MastheadButton onClick={() => setOpen(true)}>Send feedback</MastheadButton>}
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
