-- Call the patient when staff open the next step (docs/domains/clinic.md, "Service points").
--
-- Opening Triage & vitals, Start consultation or Procedures for a ticket can call the patient to the place where that step
-- happens, as if staff had typed it under "Call patient to" (called_at / called_to on the visit, so the waiting-room display
-- shows and announces it). The place for each step is the facility's own text ("Triage", "Room 2"); no place for a step =
-- nothing is called for it, and the manual call stays as it was. Off by default.

ALTER TABLE service_point_setting
  ADD COLUMN call_on_triage_to        text CHECK (call_on_triage_to IS NULL OR length(btrim(call_on_triage_to)) BETWEEN 1 AND 60),
  ADD COLUMN call_on_consultation_to  text CHECK (call_on_consultation_to IS NULL OR length(btrim(call_on_consultation_to)) BETWEEN 1 AND 60),
  ADD COLUMN call_on_procedure_to     text CHECK (call_on_procedure_to IS NULL OR length(btrim(call_on_procedure_to)) BETWEEN 1 AND 60);
