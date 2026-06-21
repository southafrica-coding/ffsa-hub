import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Space Bookings moved from /bookings/* to /bookings/spaces/* when the
    // /bookings hub was introduced. Keep old bookmarks/deep-links working.
    return [
      { source: "/bookings/new", destination: "/bookings/spaces/new", permanent: false },
      { source: "/bookings/requests", destination: "/bookings/spaces/requests", permanent: false },
      { source: "/bookings/my-requests", destination: "/bookings/spaces/my-requests", permanent: false },
      { source: "/bookings/venues", destination: "/bookings/spaces/venues", permanent: false },
    ];
  },
};

export default nextConfig;
