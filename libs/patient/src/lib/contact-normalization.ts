import { BusinessRuleError, normalizePhMobile } from "@healthcare/core";
import type { ContactSystem } from "./patient.schema";

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Canonical form used for matching and delivery:
 * - mobile: E.164; Philippine formats (09XX…, +63…, 63…) are recognized
 * - phone: digits with optional leading +
 * - email: lower-case
 */
export function normalizeContact(system: ContactSystem, value: string): string {
  const trimmed = value.trim();
  switch (system) {
    case "mobile": {
      const ph = normalizePhMobile(trimmed);
      if (ph) return ph;
      const compact = trimmed.replace(/[\s().-]/g, "");
      if (E164.test(compact)) return compact;
      throw new BusinessRuleError(`"${value}" is not a valid mobile number`, "invalid_contact");
    }
    case "phone": {
      const compact = trimmed.replace(/[^\d+]/g, "");
      if (compact.replace("+", "").length < 7) throw new BusinessRuleError(`"${value}" is not a valid phone number`, "invalid_contact");
      return compact;
    }
    case "email": {
      const lower = trimmed.toLowerCase();
      if (!EMAIL.test(lower)) throw new BusinessRuleError(`"${value}" is not a valid email address`, "invalid_contact");
      return lower;
    }
  }
}
