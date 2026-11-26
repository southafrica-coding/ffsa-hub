import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Store PDF pipeline (src/lib/store/pdf): pdfjs and the native canvas are
  // loaded at runtime, not bundled, and pdfjs's standard-font data and the
  // watermark font are traced into the functions that need them.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/store/admin/assets/[id]/render": ["./node_modules/pdfjs-dist/standard_fonts/**/*"],
    "/api/store/page": ["./public/brand/fonts/RobotoCondensed-Bold.ttf"],
    "/api/store/library/[productId]/pdf": ["./public/brand/fonts/RobotoCondensed-Bold.ttf"],
  },
  eslint: {
    // Lint is a manual/dev tool (`npm run lint`), not a build gate. The repo
    // carries pre-existing lint errors; keep them out of the deploy path so
    // adding an ESLint config doesn't start failing `next build` on Vercel.
    ignoreDuringBuilds: true,
  },
  async headers() {
    // App links for the phone app (public/.well-known). Apple fetches the
    // association file by a fixed name with no extension and requires JSON;
    // Android's assetlinks.json is served as JSON by its extension, but say
    // so explicitly. Short cache so replacing the placeholders takes effect.
    const json = [
      { key: "Content-Type", value: "application/json" },
      { key: "Cache-Control", value: "public, max-age=3600" },
    ];
    return [
      { source: "/.well-known/apple-app-site-association", headers: json },
      { source: "/.well-known/assetlinks.json", headers: json },
    ];
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
