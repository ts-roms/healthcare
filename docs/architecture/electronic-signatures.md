# Electronic signatures — scope (proposal)

Status: **phase 1 built** (migration `0120`; phases 2 and 3 are proposals). No Philippine rule on the legal effect of an electronic signature on clinical consent is encoded; whether a drawn signature
or a typed acknowledgement is valid for a given document is the organization's decision with its legal adviser (register it in
`docs/security/compliance-dependencies.md` when the first phase is built).

## What exists today

| Document                             | How agreement is recorded now                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Procedure consent                    | `clinic_procedure_consent` (migration 0095): `captured_via` paper / electronic / verbal, who gave it, who obtained it, wording version, optional scan (`consent_form` document) |
| Patient consents (MyHealth)          | Electronic acknowledgement by the portal account against the organization's wording version                                                                                     |
| Dental estimate                      | Optional `dental_written_estimate` flag: a signed copy exists                                                                                                                   |
| Medical certificate, referral letter | Issued by an authenticated practitioner; the PDF names them and their license number; no signature mark                                                                         |

`captured_via = 'electronic'` today means "recorded electronically", not "signed electronically": there is no signature evidence behind it.

## Principle

A signature here is **evidence bound to one exact document**, not a picture. Each signature record stores what was shown (the rendered PDF's `sha256`), who
signed, how they were identified, when, and the strokes. Append-only, never edited, withdrawn only by a later record.

## Phase 1 — sign procedure consent on a tablet (recommended first)

- **Flow:** staff open the procedure's consent form (existing `consent-form.pdf` content) on a tablet → the patient (or named representative) reads the wording →
  draws a signature → staff confirm identity was checked → the signed PDF is rendered once and stored as a `consent_form` document → linked through the existing
  `POST /procedures/:id/consent` (`captured_via = 'electronic'`).
- **Table `document_signature`** (append-only trigger): `document_id` (the stored signed PDF), `document_sha256` (of the PDF _before_ the mark was added, i.e.
  what was shown), `signer_kind` patient | representative | practitioner, `signer_name`, `signer_relationship`, `identity_check` (free text: what staff checked),
  `method` drawn | typed | portal_account, `strokes` (compact vector data, JSONB), `signed_at`, `witness_user_id`, `device` (user agent only), `recorded_by`.
- **PDF:** `libs/pdf` places the signature image, name, date and a short verification footer (document id + hash prefix) on the consent page.
- **Verify:** `GET /documents/:id/signatures` lists them; recomputing the hash of the stored original shows nothing changed. The integrity review (D7) already
  covers tampering with the stored file.
- **Permissions:** reuse `procedure.record` to capture; `document.read` to view. No new permission needed in phase 1.
- **Audit:** `document.sign` with ids only (never strokes).
- **Out of scope:** cryptographic (PKI) signatures, third-party signing providers, certificates.

## Phase 2 — sign from MyHealth

Patient reviews and signs the same document in MyHealth when the clinic sends it (dental plan acceptance, procedure consent ahead of a visit). Method
`portal_account`, with the portal session and a fresh password or passkey check as identity evidence. Reuses the dental online-decision pattern (the
organization's own acknowledgement text, channel and account recorded).

## Phase 3 — practitioner signature on certificates and letters

Store a practitioner's signature image (their own, uploaded once, `document` of category `signature`) and print it on medical certificates and referral letters
at issue time. Cosmetic only unless the organization decides otherwise: the authentication of the issuer remains the real control. Decide with the organization
before building; some may prefer none.

## Risks and decisions needed

1. Legal validity of a drawn signature for each document type (organization / counsel).
2. Who may sign for a minor or an incapacitated patient — not encoded; staff record the representative as written (as for consent today).
3. Retention of signature evidence follows the document's retention category.
4. Data Privacy Act: a signature is personal data; strokes are never in logs, audit values, notices or FHIR exports.
5. Accessibility: a patient who cannot draw keeps the paper + scan route.

## Effort (rough)

Phase 1: one migration, one service in `libs/clinic` behind a documents port, a signature-pad client component in the staff app, `libs/pdf` mark, integration and
e2e tests, docs and manual. Phases 2 and 3 are separate decisions.
