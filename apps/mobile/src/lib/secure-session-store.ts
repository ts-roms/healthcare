import * as SecureStore from "expo-secure-store";
import type { SessionStore } from "./api";
import type { StoredSession } from "./types";

const KEY = "myhealth.session";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** The session lives in the phone's Keychain / Keystore, only on this device, and only while it is unlocked. */
export const secureSessionStore: SessionStore = {
  async load(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredSession>;
      return typeof value.accessToken === "string" && typeof value.refreshToken === "string" && typeof value.refreshTokenExpiresAt === "string"
        ? { accessToken: value.accessToken, refreshToken: value.refreshToken, refreshTokenExpiresAt: value.refreshTokenExpiresAt }
        : null;
    } catch {
      return null;
    }
  },
  async save(session) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session), OPTIONS);
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  },
};
