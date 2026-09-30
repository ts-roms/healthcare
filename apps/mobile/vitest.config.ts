import { defineConfig } from "vitest/config";

// Unit tests cover the platform-neutral code in src/lib (no React Native imports), run in Node.
export default defineConfig({
  test: { include: ["src/lib/**/*.test.ts"], environment: "node" },
});
