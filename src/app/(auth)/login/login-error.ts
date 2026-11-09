/** Copy for ?error= on /login. Unknown codes show nothing. */
export function loginErrorFromParam(code: string | null): string | null {
  if (code === "deactivated") {
    return "Your account has been deactivated. Please contact the admin team to restore access.";
  }
  if (code === "signout") {
    return "We couldn't sign you out. Please try again.";
  }
  return null;
}
