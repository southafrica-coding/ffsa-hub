import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Lint is a manual/dev tool (`npm run lint`), not a build gate. The repo
    // carries pre-existing lint errors; keep them out of the deploy path so
    // adding an ESLint config doesn't start failing `next build` on Vercel.
    ignoreDuringBuilds: true,
  },
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
