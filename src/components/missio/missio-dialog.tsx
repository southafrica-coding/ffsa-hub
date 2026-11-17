"use client";

import type { CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { missioSkinVars } from "./access";
import styles from "./shell.module.css";

/**
 * Missio dialog on the same Radix primitive as the rest of the hub.
 * Escape closes, focus is trapped, the first field is focused, and focus
 * returns to whatever opened it. The content portals to document.body, outside
 * the shell, so the skin tokens and both faces are copied onto the dialog.
 */
function dialogStyle(): { style: CSSProperties; display: string } {
  let display = "Fraunces, Georgia, serif";
  let body = "Archivo, system-ui, sans-serif";
  if (typeof document !== "undefined") {
    const source = document.querySelector("[data-missio-font]");
    if (source) {
      const computed = getComputedStyle(source);
      display = computed.getPropertyValue("--font-missio-display").trim() || display;
      body = computed.getPropertyValue("--font-missio-body").trim() || body;
    }
  }
  return {
    display,
    style: {
      ...missioSkinVars(),
      "--display": display,
      "--body": body,
      fontFamily: body,
    } as CSSProperties,
  };
}

export function MissioDialog({
  onClose,
  title,
  testId,
  children,
}: {
  onClose: () => void;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  const faces = dialogStyle();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.backdrop} />
        <Dialog.Content
          className={styles.dialog}
          style={faces.style}
          aria-describedby={undefined}
          data-testid={testId}
          data-missio-dialog=""
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = event.currentTarget as HTMLElement;
            content.querySelector<HTMLElement>("input, select, textarea")?.focus();
          }}
        >
          <Dialog.Title className={styles.dialogTitle} style={{ fontFamily: faces.display }}>
            {title}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
