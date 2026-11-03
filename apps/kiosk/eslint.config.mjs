import nextVitals from "eslint-config-next/core-web-vitals";
import baseConfig from "../../eslint.config.mjs";

const config = [
  ...baseConfig,
  ...nextVitals,
  {
    settings: { next: { rootDir: import.meta.dirname } },
  },
];

export default config;
