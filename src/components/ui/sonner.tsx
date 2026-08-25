"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        duration: 4000,
        style: {
          background: "var(--surface-1)",
          border: "1px solid var(--ink)",
          color: "var(--text-primary)",
          borderRadius: "10px",
          fontFamily: "var(--font-roboto, 'Roboto', sans-serif)",
          fontSize: "13px",
        },
      }}
    />
  );
}
