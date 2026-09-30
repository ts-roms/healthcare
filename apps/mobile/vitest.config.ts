import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only the pure code in src/lib is tested here (no React Native runtime); screens are type-checked.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
