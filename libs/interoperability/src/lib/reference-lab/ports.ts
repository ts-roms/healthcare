import type { ReferenceLabDispatchSource } from "./send-out-package";

/**
 * What the reference-laboratory integration needs from the laboratory and patient domains, implemented by the app's
 * composition root (apps/api/src/app/adapters/reference-lab-adapters.ts). This library never reads laboratory tables.
 */
export interface ReferenceLabSources {
  /** The dispatch with the tests still travelling in it and the patients' identity; undefined when it does not exist. */
  forDispatch(organizationId: string, dispatchId: string): Promise<(ReferenceLabDispatchSource & { patientIds: string[] }) | undefined>;
}
export const REFERENCE_LAB_SOURCES = Symbol("REFERENCE_LAB_SOURCES");

/** Tells the laboratory that the reference laboratory acknowledged an electronic submission (it records the reference). */
export interface ReferenceLabSink {
  dispatchAcknowledged(input: { organizationId: string; dispatchId: string; reference: string; exchangeId: string }): Promise<void>;
}
export const REFERENCE_LAB_SINK = Symbol("REFERENCE_LAB_SINK");
