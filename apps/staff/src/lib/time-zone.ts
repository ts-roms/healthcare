import "server-only";
import { cache } from "react";
import { setClinicTimeZoneResolver } from "@healthcare/ui/healthcare";

/**
 * The selected facility's time zone for this request, so server-rendered clinical times use it. Request-scoped
 * (React `cache`): concurrent requests for facilities in different zones never share it. Filled from the time-zone
 * cookie on every API call and by the staff layout; the design system's format helpers read it.
 */
const requestTimeZone = cache((): { value?: string } => ({}));

setClinicTimeZoneResolver(() => requestTimeZone().value);

export function setRequestTimeZone(timeZone: string | null | undefined): void {
  if (timeZone) requestTimeZone().value = timeZone;
}
