// Bookings screens draw their own back button. Opened from a Home feed item
// there may be nothing to go back to, so fall back to the parent screen.

type BackRouter = { back: () => void; replace: (href: never) => void; canGoBack?: () => boolean };

export function goBackTo(router: BackRouter, parent: "/bookings" | `/bookings/vehicle/${string}`) {
  if (router.canGoBack?.()) router.back();
  else router.replace(parent as never);
}
