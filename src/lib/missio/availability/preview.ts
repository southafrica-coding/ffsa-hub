/** Screenshot routes only. Production never serves them, even if the flag is set. */
export function availabilityPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.MISSIO_SCREENSHOTS === "1";
}
