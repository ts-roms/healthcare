import baseConfig from "../../eslint.config.mjs";

const config = [...baseConfig, { ignores: [".expo/**", "dist/**", "expo-env.d.ts"] }];

export default config;
