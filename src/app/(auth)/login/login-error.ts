import { formatOpensOn } from "@/lib/auth/access-hold";

/** Copy for ?error= on /login. Unknown codes show nothing. */
export function loginErrorFromParam(
  code: string | null,
  opensOn: string | null = null
): string | null {
  if (code === "not_open") {
    const when =
      opensOn && /^\d{4}-\d{2}-\d{2}$/.test(opensOn)
        ? `on ${formatOpensOn(opensOn)}`
        : "a month before your school starts";
    return `Your HUB account isn't open yet. It opens ${when} — we'll email you then.`;
  }
  if (code === "deactivated") {
    return "Your account has been deactivated. Please contact the admin team to restore access.";
  }
  if (code === "signout") {
    return "We couldn't sign you out. Please try again.";
  }
  return null;
}
