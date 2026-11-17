"use client";

import * as Dialog from "@radix-ui/react-dialog";
import styles from "./shell.module.css";

/**
 * Missio dialog on the same Radix primitive as the rest of the hub.
 * Escape closes, focus is trapped, the first field is focused, and focus
 * returns to whatever opened it.
 */
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
          aria-describedby={undefined}
          data-testid={testId}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = event.currentTarget as HTMLElement;
            content.querySelector<HTMLElement>("input, select, textarea")?.focus();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
