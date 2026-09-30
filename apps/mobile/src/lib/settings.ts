import { readSettings } from "./config";

// Metro replaces these literal `process.env.EXPO_PUBLIC_*` reads at build time; they cannot be looked up by a variable name.
export const settings = readSettings(
  {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_ORGANIZATION_CODE: process.env.EXPO_PUBLIC_ORGANIZATION_CODE,
    EXPO_PUBLIC_PORTAL_URL: process.env.EXPO_PUBLIC_PORTAL_URL,
  },
  __DEV__,
);
