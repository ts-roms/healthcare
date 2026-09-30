import "server-only";
import { ApiError } from "@healthcare/web-session";
import { api } from "./client";
import { can, getSelectedFacility, getSession } from "./session";
import type { ImmunizationRecord, Vaccine, VaccineStockLot } from "./types";

const tolerate = <T>(call: () => Promise<T>): Promise<T | null> =>
  call().catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 400)) return null;
    throw error;
  });

export interface ImmunizationScreenData {
  /** The history (audited by the API); null without immunization.read. */
  records: ImmunizationRecord[] | null;
  /** Active catalogue vaccines (for recording); empty without access. */
  vaccines: Vaccine[];
  /** Vaccine lots in stock at the selected facility; null when stock cannot be used (no facility or no access). */
  lots: VaccineStockLot[] | null;
  canRecord: boolean;
  facilitySelected: boolean;
}

/** Everything an immunization panel needs, loaded in parallel; parts the user may not see are null or empty. */
export async function loadImmunizationData(patientId: string, options: { encounterId?: string } = {}): Promise<ImmunizationScreenData> {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  const canRead = can(session, "immunization.read");
  const canRecord = can(session, "immunization.record");
  const [records, vaccines, lots] = await Promise.all([
    canRead
      ? tolerate(() =>
          api<ImmunizationRecord[]>(options.encounterId ? `/encounters/${options.encounterId}/immunizations` : `/patients/${patientId}/immunizations`),
        )
      : Promise.resolve(null),
    canRead && canRecord ? tolerate(() => api<Vaccine[]>("/immunizations/catalog")) : Promise.resolve(null),
    canRecord && facility ? tolerate(() => api<VaccineStockLot[]>("/immunizations/stock")) : Promise.resolve(null),
  ]);
  return { records, vaccines: vaccines ?? [], lots, canRecord, facilitySelected: facility !== null };
}

/** The patient's available documents (title only) to link as a scan; null without document.read. */
export async function loadLinkableDocuments(patientId: string): Promise<Array<{ id: string; title: string }> | null> {
  const session = await getSession();
  if (!can(session, "document.read")) return null;
  const docs = await tolerate(() => api<Array<{ id: string; title: string; status: string }>>("/documents", { query: { patientId } }));
  return docs ? docs.filter((d) => d.status === "available").map((d) => ({ id: d.id, title: d.title })) : null;
}
