# Reference laboratories (send-out tests) — adapter stubs

| Item            | Value                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External system | External reference laboratories that perform tests a facility refers out                                                                                  |
| Specification   | **Not obtained.** No reference laboratory's electronic interface (HL7 v2 ORM/OML/ORU, ASTM E1394/LIS2, a vendor API), transport or agreement is on record |
| Status          | **Dependency** — the send-out workflow is complete on paper (manifest); a format-neutral package, the port and an unconfigured adapter exist              |
| Version         | —                                                                                                                                                         |
| Contact         | — (per reference laboratory, once an interface is agreed)                                                                                                 |
| Code            | `libs/laboratory/src/lib/send-outs`, `libs/interoperability/src/lib/reference-lab`, `apps/api/src/app/adapters/reference-lab-adapters.ts`                 |
| Staff app       | `/laboratory/send-outs`, reference laboratories and referred tests in `/laboratory/catalog`                                                               |
| Migration       | `0047_reference_laboratory.sql`                                                                                                                           |

Root `CLAUDE.md` §36 and `libs/interoperability/CLAUDE.md`: never invent an external format. Every reference laboratory
has its own interface (if any) and its own test codes; nothing here encodes a message layout, segment, code system
mapping or transport. Until an interface is agreed with a specific laboratory and its specification is documented
here, specimens travel with the printed manifest and results are entered from the laboratory's report.

## What exists

The clinical workflow is the laboratory's (see [docs/domains/laboratory.md](../domains/laboratory.md#send-out-tests)):

- **Configuration** (organization, `lab.catalog.manage`, audited): reference laboratories (name, code, contact, the
  accreditation / licence reference **as recorded by staff — the platform does not verify it**), and per facility which
  catalog tests its laboratory refers out, to which reference laboratory, with an expected turnaround.
- **Send-out** per referred test, prepared when the specimen is received (or by hand): `prepared → dispatched →
results_received | rejected | cancelled`, the reference laboratory's own accession number, and a **dispatch** per
  handover (manifest number `SM########`, courier and its reference, time) with a printable manifest.
- **Results back** are entered as normal, versioned results attributed to the reference laboratory
  (`performing_laboratory`) and verified, approved and released under the same rules as in-house results; released
  results are corrected, never overwritten. "Performed by" appears on results, the patient record and the printed report.

The electronic side (this document):

- **Package** (`send-out-package.ts`): `ReferenceLabSendOutPackage` — the platform's own, format-neutral description of
  one dispatch: manifest number, dispatch time, courier, sending facility, the reference laboratory's code and name, and
  per specimen its accession number, specimen type and container, collection time, order number, priority, fasting,
  clinical indication, requesting physician, the patient's number, name, sex and birth date (no PhilHealth PIN, no
  internal ids), and the tests (the platform's test code and name, LOINC when configured, the send-out id). Only tests
  still travelling in the dispatch are included (cancelled, rejected and answered ones are left out).
- **Readiness** (`sendOutReadiness`): checks of the platform's own data only (something left to send; every patient
  record readable) — never a rule of the receiving laboratory.
- **Port** `ReferenceLabGateway` (`gateway.ts`): `specification` and `submitSendOut(package, idempotencyKey)`.
  `UnconfiguredReferenceLabGateway` is the default: status `dependency`, transmits nothing (`not_configured`).
- **Submission** (API, `ReferenceLabSubmissions`): `POST /api/v1/integrations/reference-laboratories/dispatches/:dispatchId/submissions`
  (`lab.specimen.receive`, body `{ idempotencyKey }`) is **refused with `integration_not_configured`** while the gateway
  is a dependency. With an adapter it seals the package (`IntegrationExchanges.request`, system `reference-laboratory`,
  operation `submit_send_out`, resource `lab_send_out_dispatch`) for the integration worker; the same idempotency key
  returns the same exchange; another submission is refused while one is queued or was accepted (`already_submitted`).
  Each patient in the dispatch gets an audit event (`lab.send-out.submit-request`); the exchange carries the patient id
  when the dispatch holds one patient.
- **Worker** (`ReferenceLabSendOutHandler`, registered in `IntegrationWorkerModule`): sends the sealed package through
  the configured gateway, with the worker's retries, reconciliation and payload handling
  ([integration-worker.md](../architecture/integration-worker.md)).
- **Outcome**: `IntegrationExchangeCompleted` (outbox) → an accepted submission's external reference is recorded once on
  the dispatch (`electronic_reference`, audited `lab.send-out.electronic-acknowledged`) through the `ReferenceLabSink`
  port. Rejections and failures appear on the integration review screen (`/admin/integrations`); the specimens still
  travel with the manifest.
- `GET /api/v1/integrations/reference-laboratories` (the interface's status) and `GET …/dispatches/:dispatchId/submissions`
  (readiness and earlier submissions), `lab.order.read`.

## What is not modelled

- **Inbound results.** Nothing receives results electronically (no ORU/ASTM result parsing, no result code mapping, no
  unsolicited results). Results are entered by laboratory staff from the reference laboratory's report and then verified
  and approved; an inbound adapter would create entered (unverified) results through the laboratory's own result entry,
  never released ones.
- **Test code mapping** between the platform's catalog and each reference laboratory's codes, and their units and
  reference ranges. Today the result is entered against the platform's test; the reference range snapshotted is the
  platform's catalog range. If a reference laboratory's ranges differ, configure the test's ranges accordingly or record
  the laboratory's range in the result comment.
- **Specimen tracking in transit** (temperature, chain-of-custody scans), courier integrations and pick-up scheduling.
- **Aliquots**: a send-out references the specimen as collected; splitting into aliquots with their own labels is not
  modelled.
- **Billing** of referred tests (reference laboratory fees, charging the patient) is unchanged: charges follow the
  order as for in-house tests.
- **Regulatory rules** for referral (which laboratories a facility may refer to, licensing checks, retention of the
  reference laboratory's report) are not encoded: the accreditation reference is recorded, not verified.

## To connect a reference laboratory

1. Obtain its interface specification and agreement (message format and version, transport, authentication, test code
   list, acknowledgement semantics, how it returns results) and record them here (spec source, version, contact).
2. Implement `ReferenceLabGateway` mapping `ReferenceLabSendOutPackage` to that interface (idempotent per key; return
   `accepted` with the laboratory's reference, `rejected` with its reasons, or a retryable failure). Credentials come from
   secrets management.
3. Provide it to the API (`AppModule.forRoot` override `referenceLabGateway`) and the worker
   (`IntegrationWorkerModule.forRoot({ referenceLabGateway })`). Several laboratories need one gateway that routes by
   `package.referenceLaboratory.code`, or a per-laboratory registry — decide with the first two real interfaces.
4. Update [dependencies.md](dependencies.md) with the status (`stubbed` against a documented but uncertified
   specification, then `implemented`).
