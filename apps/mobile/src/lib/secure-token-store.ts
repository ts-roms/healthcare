import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "./session";

const KEY = "myhealth.refresh-token";

/**
 * The refresh token in the iOS Keychain / Android Keystore, readable only while the device is unlocked and never
 * copied to backups or another device (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Nothing else about the patient is stored.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureTokenStore: TokenStore = {
  read: () => SecureStore.getItemAsync(KEY, OPTIONS),
  write: (refreshToken) => SecureStore.setItemAsync(KEY, refreshToken, OPTIONS),
  clear: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
};
