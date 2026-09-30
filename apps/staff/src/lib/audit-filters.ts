/**
 * The audit log page's filters, read from the URL and turned into the API's query. Dates are local days in the
 * clinic's time zone (Asia/Manila, UTC+8, no daylight saving) and cover the whole day.
 */
export interface AuditFilters {
  from: string;
  to: string;
  action: string;
  resourceType: string;
  actor: string;
  patient: string;
  page: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: string | undefined, max: number) => (value ?? "").trim().slice(0, max);

export function readAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const page = Number.parseInt(one("page") ?? "1", 10);
  return {
    from: DATE.test(one("from") ?? "") ? (one("from") as string) : "",
    to: DATE.test(one("to") ?? "") ? (one("to") as string) : "",
    action: clean(one("action"), 128),
    resourceType: clean(one("resourceType"), 64),
    actor: UUID.test(one("actor") ?? "") ? (one("actor") as string) : "",
    patient: UUID.test(one("patient") ?? "") ? (one("patient") as string) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function auditApiQuery(filters: AuditFilters, pageSize = 50): Record<string, string | number | undefined> {
  return {
    from: filters.from ? `${filters.from}T00:00:00+08:00` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999+08:00` : undefined,
    action: filters.action || undefined,
    resourceType: filters.resourceType || undefined,
    actorUserId: filters.actor || undefined,
    patientId: filters.patient || undefined,
    page: filters.page,
    pageSize,
  };
}

/** The URL of the same search on another page. */
export function auditPageHref(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page: String(page) }))
    if (value && !(key === "page" && value === "1")) params.set(key, String(value));
  const query = params.toString();
  return query ? `/admin/audit?${query}` : "/admin/audit";
}
