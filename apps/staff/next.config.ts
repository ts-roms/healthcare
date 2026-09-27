import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@healthcare/ui", "@healthcare/domain"],
  experimental: {
    // Signed consent forms (≤ 10 MB, lib/consent-form.ts) are uploaded through a server action,
    // which passes the proxy first. Both limits leave room for multipart overhead.
    serverActions: { bodySizeLimit: "12mb" },
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
