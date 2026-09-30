import type { CommunicationCategory } from "../patient.schema";
import type { PortalPreferenceChannel } from "./portal-preferences.rules";

/** One choice: a channel and a kind of message. */
export interface PortalPreferenceView {
  channel: PortalPreferenceChannel;
  category: CommunicationCategory;
  /** The patient's recorded choice, or null when none was made (the clinic's default applies). */
  choice: boolean | null;
  /** Whether such messages are sent now (the choice, or the default when none). */
  enabled: boolean;
  recordedVia: "clinic" | "myhealth" | null;
  updatedAt: string | null;
}

export interface PortalPreferencesView {
  /** Where each channel reaches the patient, masked; null when the record has none (nothing can be sent there). */
  destinations: Record<PortalPreferenceChannel, string | null>;
  preferences: PortalPreferenceView[];
}
