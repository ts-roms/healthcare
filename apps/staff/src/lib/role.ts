import { cookies } from "next/headers";
import { isStaffRole, type StaffRole } from "@healthcare/domain";

export const ROLE_COOKIE = "hc-role";

/** Demo only: in production the role comes from the authenticated session, not a cookie the user can set. */
export async function getRole(): Promise<StaffRole> {
  const value = (await cookies()).get(ROLE_COOKIE)?.value;
  return isStaffRole(value) ? value : "doctor";
}
