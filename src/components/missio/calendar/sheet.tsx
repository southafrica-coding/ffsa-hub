"use client";

import { useMemo, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { missioSkinVars } from "../access";
import { missioPortalClass } from "../portal";
import shell from "../shell.module.css";
import styles from "./calendar.module.css";

function faces(): CSSProperties {
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
  return { ...missioSkinVars(), "--display": display, "--body": body, fontFamily: body } as CSSProperties;
}

/**
 * A sheet on the phone (it rises from the bottom, under the thumb) and a
 * centred panel from 768px. Same Radix dialog as MissioDialog: Escape
 * closes, focus is trapped and goes back to what opened it.
 */
export function CalendarSheet({
  title,
  testId,
  onClose,
  children,
  footer,
  focusFirstField = true,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned under the scrolling body, so Save stays in reach. */
  footer?: React.ReactNode;
  focusFirstField?: boolean;
}) {
  const style = useMemo(() => faces(), []);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={shell.backdrop} />
        <Dialog.Content
          className={missioPortalClass(`${shell.dialog} ${styles.sheet}`)}
          style={style}
          aria-describedby={undefined}
          data-testid={testId}
          data-missio-dialog=""
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = event.currentTarget as HTMLElement;
            const target = focusFirstField
              ? content.querySelector<HTMLElement>("input, select, textarea")
              : content.querySelector<HTMLElement>("[data-autofocus]");
            (target ?? content.querySelector<HTMLElement>("button"))?.focus();
          }}
        >
          <div className={styles.sheetGrip} aria-hidden="true" />
          <div className={styles.sheetHead}>
            <Dialog.Title className={`${shell.dialogTitle} ${styles.sheetTitle}`}>{title}</Dialog.Title>
            <Dialog.Close className={styles.sheetClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>
          <div className={styles.sheetBody}>{children}</div>
          {footer ? <div className={styles.sheetFoot}>{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
