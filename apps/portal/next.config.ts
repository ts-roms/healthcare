import type { NextConfig } from "next";

/**
 * Browser hardening for every response (docs/security-audit, VR-23). No script-src policy is set: Next.js writes inline
 * scripts a strict one would block; the directives below do not depend on them. Camera and microphone stay available to
 * the app itself (video consultations, QR scanning).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  transpilePackages: ["@healthcare/ui", "@healthcare/domain"],
};

export default nextConfig;
