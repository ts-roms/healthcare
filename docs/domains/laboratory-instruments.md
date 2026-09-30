# Laboratory analyzer interfaces (HL7 v2 / ASTM)

## Purpose

Let analyzers send their results to the laboratory instead of staff typing them, **without** letting a machine put a
result in a patient's record. Every value an analyzer sends waits for a person, who accepts it into the ordinary result
workflow (entry → verification → approval → release) or sets it aside with a reason.

## Pieces

| Piece                                                     | Where                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Message formats: HL7 v2 ORU^R01, ASTM E1394 records       | `libs/interoperability/src/lib/instruments/instrument-messages.ts`              |
| Link layers: MLLP + HL7 ACK, ASTM E1381 session           | `libs/interoperability/src/lib/instruments/instrument-links.ts`                 |
| The laboratory's port, settings, intake, matching, review | `libs/laboratory/src/lib/instruments` (`LabInstrumentInterfaceService`)         |
| Adapter joining the two                                   | `apps/api/src/app/adapters/instrument-adapters.ts`                              |
| On-site gateway (TCP listeners → API)                     | `apps/instrument-gateway`                                                       |
| Staff screens                                             | `/laboratory/instrument-results`; the instrument's **Analyzer interface** panel |

The laboratory never parses a wire format (libs/laboratory/CLAUDE.md: instrument interfaces go through the
interoperability layer); it defines `InstrumentMessageReader` and the API wires the interoperability parsers behind it.
The gateway imports only `@healthcare/interoperability/instruments` (no Nest modules).

## Sources for the formats

The field positions and framing follow published standards as implemented by two open-source libraries, used as the
reference (their definitions were read, and test fixtures were generated with them):

- **HL7 v2.5.1** — `hl7apy`: segment fields (MSH, OBR, OBX, SPM, MSA), the ORU_R01 structure (result OBX after the OBR;
  OBX inside the specimen group describes the specimen), delimiter order in MSH-2 (component, repetition, escape,
  subcomponent), MLLP start/end blocks (VT … FS CR), acknowledgment codes (table 0008: AA, AE, AR). The ACK the gateway
  returns parses with hl7apy.
- **ASTM E1394 / E1381** (CLSI LIS2-A2 / LIS1-A) — `python-astm`: record layouts (H-3 message control id; O-3 specimen
  id, O-4 instrument specimen id; R-3 universal test id, R-4 value, R-5 units, R-6 reference ranges, R-7 abnormal flags,
  R-9 result status, R-13 completed), the H delimiter definition, frame layout (STX, frame number, text, ETB or CR ETX,
  checksum, CR LF), checksum (byte sum mod 256, two hex digits) and control characters (ENQ, ACK, NAK, EOT).

**Not interpreted:** the meanings of analyzer abnormal flags (HL7 table 0078, ASTM R-7) and result status codes (HL7
table 0085, ASTM R-9) are not encoded. They are stored and shown as sent; the laboratory's own reference ranges flag the
value once it is entered. Analyzers differ (where the barcode goes, which component holds the test code, ACK
expectations, timeouts): **validate each analyzer against its vendor's interface specification before live use.**

## Entities (migration 0075)

- `lab_instrument_interface` — per instrument: `protocol` (`hl7v2` | `astm`), `specimen_id_field` (`OBR-2`, `OBR-3`,
  `SPM-2` | `O-3`, `O-4`; checked against the protocol), `enabled`, version.
- `lab_instrument_test_code` — analyzer code → catalog test, per instrument (configuration; replaced freely).
- `lab_instrument_message` — every message as received (content ≤ 1 MiB, `read` or `rejected` with the reader's error
  code, result count); append-only (trigger). One `read` message per instrument and control id (HL7 MSH-10 / ASTM H-3):
  a repeated delivery is acknowledged without adding anything.
- `lab_instrument_result` — each result of a message: what was sent (specimen code, analyzer code, value, units,
  reference range, flags, status, analyzer time — all raw), the match (patient, specimen, order item, test) or the
  problem (`no_specimen_id`, `unknown_specimen`, `no_test_code`, `unmapped_code`, `test_not_ordered`), and the decision
  (`pending` → `accepted` with the result id, or `dismissed` with a reason). A decided row never changes and nothing is
  deleted (trigger); the database requires a match for acceptance and a reason for dismissal.

## Flow

1. **Receive** — `POST /laboratory/instruments/:id/messages` `{ message }` by an account holding
   **`lab.instrument.message.submit`** (org_admin by default; grant it to the gateway's integration account's role).
   Refused while the interface is not enabled (`interface_not_enabled`). A message the reader cannot read is kept as
   `rejected` and refused (`422 instrument_message_unreadable`, `details.reason` = `not_hl7`, `not_astm`,
   `unsupported_message_type` (not ORU), `checksum_mismatch`, `malformed_frame`). Audited `lab.instrument.message.receive`.
2. **Match** — the specimen by accession number at the instrument's facility (from the configured field), the test by
   the instrument's analyzer-code mapping, the order item on that specimen for that test (not cancelled).
3. **Review** — `GET /laboratory/instrument-results?state=pending|decided` (`lab.result.read`, facility selected;
   audited). `POST /instrument-results/:id/accept` (`lab.result.enter`): the value is entered in the same transaction
   through `LabResultService.enterWithin` with the instrument as `instrumentId` — so every entry rule applies (specimen
   received, no result yet, QC policy `qc_required`, competency policy, reagent lots recorded, reagent runs counted) and
   the result then goes through verification and approval as any other. `POST /instrument-results/:id/dismiss` with a
   reason (`lab.result.enter`). Both audited.

**Value rules** (`instrument-interface.rules.ts`): a numeric test takes a plain decimal number (`<0.5`, `1e3`, `1,200`
are refused — enter by hand); when the analyzer and the catalog both state a unit they must match, ignoring case and
spaces (**no unit conversion**, `instrument_unit_mismatch`); a coded test takes the value as its coded value (checked at
entry against the test's values); a text test takes the text.

## Instrument gateway (`apps/instrument-gateway`)

Runs at the facility, next to the analyzers (they speak TCP on the local network; serial analyzers need a serial-to-TCP
device). One listener per instrument:

- **HL7 v2 (MLLP):** each message is posted to the API, then acknowledged — `AA` when the platform took it (or already
  had it), `AR` when it refused it (unreadable, not a result message, interface off), `AE` when it could not be
  delivered (network, API down), so the analyzer may resend it.
- **ASTM E1381:** ENQ → ACK; each frame → ACK when its checksum matches, NAK otherwise (the analyzer resends); at EOT the
  transmission is posted. ASTM has no application-level reply, so a delivery failure is retried after 5 s, 30 s and
  2 min, then logged.

It stores nothing and logs JSON lines without message content. Configuration (environment): `GATEWAY_API_URL`,
`GATEWAY_EMAIL` / `GATEWAY_PASSWORD` (an integration account without MFA holding `lab.instrument.message.submit`; exempt it under **Administration → Sign-in security** if the organization requires two-step verification),
`GATEWAY_ORGANIZATION_ID` (only for an account in several organizations), `GATEWAY_INSTRUMENTS`
(`[{ "instrumentId", "protocol": "hl7v2" | "astm", "port", "host"? }]`). Build `pnpm nx build instrument-gateway`, run
`node apps/instrument-gateway/dist/main.js`. Run it on the facility's private network only: the analyzer side has no
authentication (as the protocols have none).

## Staff screens

- **Instruments** (`/laboratory/instruments`, open an instrument): **Analyzer interface** — protocol, where the specimen
  barcode is, accept messages on/off, analyzer test codes (`lab.qc.manage` to change; `lab.qc.read` to see).
- **Instrument results** (`/laboratory/instrument-results`, menu Laboratory → Instrument results; `lab.result.read`):
  to review (oldest first) and recently decided; each row shows the specimen, patient, test, the value as sent, the
  analyzer's flag/status/range as sent, and whether it matched (with the reason when not). **Accept** (matched rows) and
  **Set aside** with a reason (`lab.result.enter`).

## Not done

- Orders to analyzers (host query / downloading worklists), bidirectional interfacing.
- Serial ports directly; analyzer-specific profiles (vendor field quirks); unit conversion.
- Counting reagent use from every analyzer run (repeats the analyzer ran on its own): only the accepted result counts,
  as with manual entry; repeats are still recorded by staff.
- QC results from analyzers (QC runs are entered on the QC screen).
