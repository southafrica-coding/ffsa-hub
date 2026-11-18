import { missioBody, missioDisplay } from "./fonts";
import portal from "./portal.module.css";

/** Class list for dialog, sheet, and popover content. Those nodes portal to document.body, outside the Missio font wrapper. */
export function missioPortalClass(extra?: string): string {
  return [portal.surface, missioBody.variable, missioDisplay.variable, missioBody.className, extra]
    .filter(Boolean)
    .join(" ");
}
