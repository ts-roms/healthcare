import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@healthcare/ui", "@healthcare/domain"],
};

export default nextConfig;
