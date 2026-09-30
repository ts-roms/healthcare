import { API_BASE_URL, ORGANIZATION_CODE } from "./config";
import { secureTokenStore } from "./secure-token-store";
import { PatientSession } from "./session";

/** The app's one session. */
export const session = new PatientSession({ baseUrl: API_BASE_URL, organizationCode: ORGANIZATION_CODE, store: secureTokenStore });
