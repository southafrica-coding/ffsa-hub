// Android notification channels, one per push category. The server sends
// each push with channelId = its category key (src/lib/push/categories.ts in
// the web repo), so these ids must match. Names show in Android's per-app
// notification settings, where people can mute a channel too.

export type ChannelDef = { id: string; name: string; description: string };

export const PUSH_CHANNELS: ChannelDef[] = [
  {
    id: "booking_requests",
    name: "Booking requests to approve",
    description: "When someone asks to book a space you approve.",
  },
  {
    id: "booking_updates",
    name: "Your bookings",
    description: "When a booking you asked for is approved or declined.",
  },
  {
    id: "training_care",
    name: "Students who need care",
    description: "When a student you lead or walk with is flagged as needing care.",
  },
];
