import { missioBody, missioDisplay } from "./fonts";
import portal from "./portal.module.css";

/** Class list for dialog, sheet, and popover content. Those nodes portal to document.body, outside the Missio font wrapper. */
export function missioPortalClass(extra?: string): string {
  // theme-light: portaled dialogs and sheets sit outside the Missio wrapper;
  // keep them on the light Hub tokens in dark mode too.
  return ["theme-light", portal.surface, missioBody.variable, missioDisplay.variable, missioBody.className, extra]
    .filter(Boolean)
    .join(" ");
}
