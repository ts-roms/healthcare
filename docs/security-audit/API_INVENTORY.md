# API route inventory

Generated 2026-11-02 by a read-only scan of every `@Controller` class under `apps/` and `libs/` (script not committed; counts cross-checked against `grep` of route decorators: 800 decorator lines vs 799 parsed routes, the one-line difference is a decorator inside a comment/docstring or non-controller file; not further verified).

Paths are relative to `/api/v1`. Auth column: **Staff** = global `AccessGuard` (Bearer access token, session re-checked per request, `libs/auth/src/lib/access.guard.ts:49-96`); **Portal** = `@Public()` for AccessGuard plus `@UseGuards(PatientAccessGuard)` (`libs/patient/src/lib/portal/patient-access.guard.ts:44-88`); **PUBLIC** = no authentication. Perm = `@RequirePermissions` (all must be held; `-` = none, authenticated only). Fac = `@RequireFacility` (X-Facility-Id mandatory). "plat" = `@RequirePlatformAdmin`. DTO shows `@Body` DTO class, `q:` = `@Query` DTO class. Thr = route-specific `@Throttle` (global default is 300 requests/minute/client address, `apps/api/src/app/app.module.ts:~205`; `CREDENTIAL_THROTTLE` = 10/min). The scan is textual: effective access is class decorators + method decorators combined; a method-level `@RequirePermissions` would REPLACE a class-level one (`getAllAndOverride`, access.guard.ts:73) -- the scan found no controller that has both.

## Summary

| Measure                                              | Count |
| ---------------------------------------------------- | ----- |
| Controller classes                                   | 108   |
| Routes parsed                                        | 799   |
| Staff routes (AccessGuard)                           | 678   |
| Portal routes (PatientAccessGuard)                   | 104   |
| PUBLIC routes (no auth at all)                       | 17    |
| Staff routes with no permission (authenticated only) | 19    |
| Staff routes marked platform-admin only              | 7     |
| Staff routes requiring X-Facility-Id                 | 166   |

## A. Every PUBLIC (unauthenticated) route and judgment

| Method | Path                                   | Throttle            | Reason / protection                                                                                                                                                           | Judgment                                                           | Src                                                             |
| ------ | -------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| GET    | /health/live                           | default             | liveness                                                                                                                                                                      | Acceptable. No data.                                               | apps/api/src/app/health.controller.ts:38                        |
| GET    | /health/ready                          | default             | readiness: reports database/redis/objectStorage/malwareScanner state; @SkipThrottle on class                                                                                  | Acceptable but discloses dependency topology (API-014 INFO).       | apps/api/src/app/health.controller.ts:49                        |
| POST   | /auth/login                            | CREDENTIAL_THROTTLE | staff sign-in; 10/min/IP + DB account lockout                                                                                                                                 | Acceptable; fails open on Redis outage (API-002).                  | libs/auth/src/lib/auth.controller.ts:61                         |
| POST   | /auth/password-reset/request           | CREDENTIAL_THROTTLE | emailed single-use link, same answer for unknown account                                                                                                                      | Acceptable.                                                        | libs/auth/src/lib/auth.controller.ts:71                         |
| POST   | /auth/password-reset                   | CREDENTIAL_THROTTLE | link token (+TOTP code when MFA on)                                                                                                                                           | Acceptable.                                                        | libs/auth/src/lib/auth.controller.ts:81                         |
| POST   | /auth/mfa/verify                       | CREDENTIAL_THROTTLE | challenge JWT (5 min, HS256) + code                                                                                                                                           | Acceptable; challenge token not single-use at JWT level (API-013). | libs/auth/src/lib/auth.controller.ts:91                         |
| POST   | /auth/refresh                          | CREDENTIAL_THROTTLE | rotating refresh token, reuse revokes                                                                                                                                         | Acceptable (auth.int.spec.ts:55-57).                               | libs/auth/src/lib/auth.controller.ts:101                        |
| POST   | /billing/online-payments/notifications | default             | PayMongo webhook: HMAC-SHA256 over raw body + 5 min timestamp tolerance, checked before any DB write (online-payment.service.ts:139-141; paymongo-payment-gateway.ts:105-118) | Acceptable. Only default 300/min throttle.                         | libs/billing/src/lib/billing.controllers.ts:474                 |
| POST   | /outreach/opt-out                      | default             | single-use emailed token                                                                                                                                                      | Acceptable; only default throttle (API-015 LOW).                   | libs/crm/src/lib/crm.controller.ts:184                          |
| POST   | /portal/auth/password-reset/request    | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/portal/portal.controller.ts:34             |
| POST   | /portal/auth/password-reset/confirm    | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/portal/portal.controller.ts:45             |
| POST   | /portal/auth/activation-card           | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/portal/portal.controller.ts:55             |
| POST   | /portal/auth/activate                  | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/portal/portal.controller.ts:65             |
| POST   | /portal/auth/login                     | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/portal/portal.controller.ts:75             |
| POST   | /portal/auth/refresh                   | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/portal/portal.controller.ts:84             |
| POST   | /portal/auth/mfa/passkey/options       | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/security/portal-security.controller.ts:223 |
| POST   | /portal/auth/mfa/verify                | CREDENTIAL_THROTTLE | MyHealth auth step (activation code/password/refresh/MFA); 10/min/IP + account lockout                                                                                        | Acceptable; fails open on Redis outage (API-002).                  | libs/patient/src/lib/security/portal-security.controller.ts:233 |

All other `@Public()` occurrences (104 routes) are the MyHealth routes of section B, where `@Public()` only opts out of the _staff_ guard and `PatientAccessGuard` is applied at class level.

## B. Staff routes with NO @RequirePermissions (authenticated session only) and judgment

| Method | Path                                    | Facility | Judgment                                                                                                                                | Src                                                     |
| ------ | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| GET    | /me/badges                              | -        | Own counts; handler gates each counter by the caller's permissions (badges.controller.ts header). Acceptable; Not verified per counter. | apps/api/src/app/badges.controller.ts:44                |
| GET    | /me/push                                | -        | Own browser subscriptions only. Acceptable.                                                                                             | apps/api/src/app/staff-push.controller.ts:38            |
| PUT    | /me/push/preferences                    | -        | Own preferences. Acceptable.                                                                                                            | apps/api/src/app/staff-push.controller.ts:53            |
| POST   | /me/push/subscriptions                  | -        | Own subscription; endpoint is caller-supplied https URL (SSRF, API-004). Throttle 20/min.                                               | apps/api/src/app/staff-push.controller.ts:66            |
| POST   | /me/push/subscriptions/:deviceId/remove | -        | Own device. Acceptable.                                                                                                                 | apps/api/src/app/staff-push.controller.ts:81            |
| POST   | /me/push/test                           | -        | Own device; throttle 5/min. Acceptable.                                                                                                 | apps/api/src/app/staff-push.controller.ts:89            |
| POST   | /auth/realtime-tickets                  | required | Own session; RequireFacility. Acceptable.                                                                                               | libs/auth/src/lib/auth.controller.ts:49                 |
| POST   | /auth/logout                            | -        | Own session. Acceptable.                                                                                                                | libs/auth/src/lib/auth.controller.ts:111                |
| GET    | /auth/me                                | -        | Own profile. Acceptable.                                                                                                                | libs/auth/src/lib/auth.controller.ts:119                |
| GET    | /auth/me/facilities                     | -        | Own facilities. Acceptable.                                                                                                             | libs/auth/src/lib/auth.controller.ts:148                |
| POST   | /auth/password                          | -        | Own password (current password required). Acceptable.                                                                                   | libs/auth/src/lib/auth.controller.ts:170                |
| POST   | /auth/mfa/setup                         | -        | Own MFA. Acceptable.                                                                                                                    | libs/auth/src/lib/auth.controller.ts:180                |
| POST   | /auth/mfa/confirm                       | -        | Own MFA. Acceptable.                                                                                                                    | libs/auth/src/lib/auth.controller.ts:188                |
| POST   | /auth/mfa/recovery-codes                | -        | Own MFA. Acceptable.                                                                                                                    | libs/auth/src/lib/auth.controller.ts:198                |
| POST   | /auth/mfa/disable                       | -        | Own MFA. Acceptable (blocked while org requires MFA per CLAUDE.md; Not verified here).                                                  | libs/auth/src/lib/auth.controller.ts:207                |
| GET    | /me/notifications                       | -        | Own inbox. Acceptable.                                                                                                                  | libs/notification/src/lib/notification.controller.ts:31 |
| GET    | /me/notifications/unread-count          | -        | Own inbox. Acceptable.                                                                                                                  | libs/notification/src/lib/notification.controller.ts:37 |
| POST   | /me/notifications/:notificationId/read  | -        | Own inbox, scoped by actor in service (Not verified that service filters by user id).                                                   | libs/notification/src/lib/notification.controller.ts:43 |
| GET    | /organization/tour-setting              | -        | Org-level boolean for any member. Acceptable.                                                                                           | libs/organization/src/lib/tour/tour.controller.ts:14    |

## C. Full route table by controller file

### apps/api/src/app/audit-retention/audit-retention.controller.ts

| Method | Path                                      | Handler    | Auth  | Perm           | Fac | DTO       | Thr | Line |
| ------ | ----------------------------------------- | ---------- | ----- | -------------- | --- | --------- | --- | ---- |
| GET    | /audit/retention/partitions               | partitions | Staff | platform-admin |     |           |     | 25   |
| POST   | /audit/retention/partitions/:name/archive | archive    | Staff | platform-admin |     |           |     | 32   |
| POST   | /audit/retention/partitions/:name/remove  | remove     | Staff | platform-admin |     | RemoveDto |     | 40   |
| GET    | /audit/retention/archives/:archiveId/file | file       | Staff | platform-admin |     |           |     | 48   |

### apps/api/src/app/badges.controller.ts

| Method | Path       | Handler | Auth  | Perm | Fac | DTO | Thr | Line |
| ------ | ---------- | ------- | ----- | ---- | --- | --- | --- | ---- |
| GET    | /me/badges | badges  | Staff | -    |     |     |     | 44   |

### apps/api/src/app/communications/communications.controller.ts

| Method | Path                                   | Handler | Auth  | Perm                            | Fac | DTO                       | Thr | Line |
| ------ | -------------------------------------- | ------- | ----- | ------------------------------- | --- | ------------------------- | --- | ---- |
| GET    | /communications                        | log     | Staff | notification.read, patient.read |     | q:CommunicationLogDto     |     | 42   |
| GET    | /communications/summary                | summary | Staff | notification.read               |     | q:CommunicationSummaryDto |     | 57   |
| GET    | /communications/export                 | export  | Staff | notification.read, patient.read |     | q:CommunicationLogDto     |     | 65   |
| POST   | /communications/:notificationId/cancel | cancel  | Staff | notification.manage             |     | CommunicationReasonDto    |     | 122  |
| POST   | /communications/:notificationId/resend | resend  | Staff | notification.manage             |     | CommunicationReasonDto    |     | 130  |

### apps/api/src/app/controlled-register/controlled-register.controller.ts

| Method | Path                                  | Handler  | Auth  | Perm                               | Fac | DTO                          | Thr | Line |
| ------ | ------------------------------------- | -------- | ----- | ---------------------------------- | --- | ---------------------------- | --- | ---- |
| GET    | /inventory/controlled-register        | register | Staff | inventory.controlled-register.read | Y   | q:ControlledRegisterQueryDto |     | 34   |
| GET    | /inventory/controlled-register/export | export   | Staff | inventory.controlled-register.read | Y   | q:ControlledRegisterQueryDto |     | 49   |

### apps/api/src/app/fhir/fhir-import.controller.ts

| Method | Path             | Handler | Auth  | Perm                | Fac | DTO     | Thr | Line |
| ------ | ---------------- | ------- | ----- | ------------------- | --- | ------- | --- | ---- |
| POST   | /fhir/r4/imports | receive | Staff | interop.fhir.import |     | unknown |     | 23   |

### apps/api/src/app/fhir/fhir.controller.ts

| Method | Path                             | Handler     | Auth  | Perm              | Fac | DTO             | Thr | Line |
| ------ | -------------------------------- | ----------- | ----- | ----------------- | --- | --------------- | --- | ---- |
| GET    | /fhir/r4/metadata                | metadata    | Staff | interop.fhir.read |     |                 |     | 46   |
| GET    | /fhir/r4/Patient/:id             | readPatient | Staff | interop.fhir.read |     |                 |     | 53   |
| GET    | /fhir/r4/Patient/:id/$everything | everything  | Staff | interop.fhir.read |     | q:Record<string |     | 69   |
| GET    | /fhir/r4/Binary/:id              | binary      | Staff | interop.fhir.read |     |                 |     | 91   |
| GET    | /fhir/r4/:type                   | search      | Staff | interop.fhir.read |     | q:Record<string |     | 103  |

### apps/api/src/app/health.controller.ts

| Method | Path          | Handler | Auth   | Perm | Fac | DTO | Thr | Line |
| ------ | ------------- | ------- | ------ | ---- | --- | --- | --- | ---- |
| GET    | /health/live  | live    | PUBLIC | -    |     |     |     | 38   |
| GET    | /health/ready | ready   | PUBLIC | -    |     |     |     | 49   |

### apps/api/src/app/management-dashboard/management-dashboard.controller.ts

| Method | Path                             | Handler   | Auth  | Perm                      | Fac | DTO                           | Thr | Line |
| ------ | -------------------------------- | --------- | ----- | ------------------------- | --- | ----------------------------- | --- | ---- |
| GET    | /management/dashboard            | get       | Staff | management.dashboard.read |     | q:ManagementDashboardQueryDto |     | 34   |
| GET    | /management/dashboard/export     | export    | Staff | management.dashboard.read |     | q:ManagementExportQueryDto    |     | 44   |
| GET    | /management/dashboard/export.pdf | exportPdf | Staff | management.dashboard.read |     | q:ManagementDashboardQueryDto |     | 58   |

### apps/api/src/app/management-dashboard/management-report.controller.ts

| Method | Path                                    | Handler        | Auth  | Perm                      | Fac | DTO                     | Thr | Line |
| ------ | --------------------------------------- | -------------- | ----- | ------------------------- | --- | ----------------------- | --- | ---- |
| GET    | /management/report-schedules            | listSchedules  | Staff | management.dashboard.read |     |                         |     | 30   |
| POST   | /management/report-schedules            | createSchedule | Staff | management.report.manage  |     | ReportScheduleDto       |     | 37   |
| PUT    | /management/report-schedules/:id        | updateSchedule | Staff | management.report.manage  |     | ReportScheduleUpdateDto |     | 47   |
| POST   | /management/report-schedules/:id/status | setStatus      | Staff | management.report.manage  |     | ReportScheduleStatusDto |     | 54   |
| GET    | /management/reports                     | listRuns       | Staff | management.dashboard.read |     | q:ReportRunsQueryDto    |     | 61   |
| GET    | /management/reports/:id/files/:table    | download       | Staff | management.dashboard.read |     |                         |     | 68   |

### apps/api/src/app/patient-360/patient-summary.controller.ts

| Method | Path                         | Handler | Auth  | Perm                        | Fac | DTO | Thr | Line |
| ------ | ---------------------------- | ------- | ----- | --------------------------- | --- | --- | --- | ---- |
| GET    | /patients/:patientId/summary | summary | Staff | patient.read, clinical.read |     |     |     | 26   |

### apps/api/src/app/patient-360/patient-workspace.controller.ts

| Method | Path                           | Handler | Auth  | Perm         | Fac | DTO | Thr | Line |
| ------ | ------------------------------ | ------- | ----- | ------------ | --- | --- | --- | ---- |
| GET    | /patients/:patientId/workspace | get     | Staff | patient.read |     |     |     | 12   |

### apps/api/src/app/patient-timeline/patient-timeline.controller.ts

| Method | Path                          | Handler | Auth  | Perm         | Fac | DTO                | Thr | Line |
| ------ | ----------------------------- | ------- | ----- | ------------ | --- | ------------------ | --- | ---- |
| GET    | /patients/:patientId/timeline | get     | Staff | patient.read |     | q:TimelineQueryDto |     | 45   |

### apps/api/src/app/portal/portal-billing.controller.ts

| Method | Path                                           | Handler             | Auth   | Perm | Fac | DTO                   | Thr | Line |
| ------ | ---------------------------------------------- | ------------------- | ------ | ---- | --- | --------------------- | --- | ---- |
| GET    | /portal/billing/online-payment                 | onlinePayment       | Portal | -    |     |                       |     | 29   |
| POST   | /portal/billing/:invoiceId/online-payments     | startOnlinePayment  | Portal | -    |     | StartOnlinePaymentDto |     | 35   |
| GET    | /portal/billing/online-payments/:intentId      | onlinePaymentStatus | Portal | -    |     |                       |     | 41   |
| GET    | /portal/billing/account                        | account             | Portal | -    |     |                       |     | 47   |
| GET    | /portal/billing/credit-notes/:creditNoteId/pdf | creditNotePdf       | Portal | -    |     |                       |     | 60   |
| GET    | /portal/billing/debit-notes/:debitNoteId/pdf   | debitNotePdf        | Portal | -    |     |                       |     | 67   |
| GET    | /portal/billing/:invoiceId/pdf                 | pdf                 | Portal | -    |     |                       |     | 74   |
| GET    | /portal/billing                                | list                | Portal | -    |     |                       |     | 81   |

### apps/api/src/app/portal/portal-booking.controller.ts

| Method | Path                                           | Handler           | Auth   | Perm | Fac | DTO                           | Thr | Line |
| ------ | ---------------------------------------------- | ----------------- | ------ | ---- | --- | ----------------------------- | --- | ---- |
| GET    | /portal/booking/options                        | options           | Portal | -    |     |                               |     | 38   |
| GET    | /portal/booking/slots                          | slots             | Portal | -    |     | q:PatientSlotsDto             |     | 44   |
| GET    | /portal/booking/waitlist                       | waitlistEntries   | Portal | -    |     |                               |     | 50   |
| GET    | /portal/booking/waitlist-allowance             | waitlistAllowance | Portal | -    |     | q:PatientWaitlistAllowanceDto |     | 56   |
| GET    | /portal/booking/offers                         | listOffers        | Portal | -    |     |                               |     | 62   |
| POST   | /portal/booking/offers/:offerId/accept         | acceptOffer       | Portal | -    |     |                               |     | 68   |
| POST   | /portal/booking/offers/:offerId/decline        | declineOffer      | Portal | -    |     |                               |     | 75   |
| POST   | /portal/booking/waitlist                       | joinWaitlist      | Portal | -    |     | PatientWaitlistJoinDto        |     | 82   |
| POST   | /portal/booking/waitlist/:entryId/leave        | leaveWaitlist     | Portal | -    |     |                               |     | 88   |
| POST   | /portal/appointments                           | book              | Portal | -    |     | PatientBookDto                |     | 95   |
| POST   | /portal/appointments/:appointmentId/reschedule | reschedule        | Portal | -    |     | PatientRescheduleDto          |     | 101  |
| POST   | /portal/appointments/:appointmentId/check-in   | checkIn           | Portal | -    |     |                               |     | 110  |
| POST   | /portal/appointments/:appointmentId/cancel     | cancel            | Portal | -    |     | PatientCancelDto              |     | 119  |

### apps/api/src/app/portal/portal-dental.controller.ts

| Method | Path                                  | Handler      | Auth   | Perm | Fac | DTO                    | Thr | Line |
| ------ | ------------------------------------- | ------------ | ------ | ---- | --- | ---------------------- | --- | ---- |
| GET    | /portal/dental/availability           | availability | Portal | -    |     |                        |     | 29   |
| GET    | /portal/dental/record                 | record       | Portal | -    |     |                        |     | 35   |
| GET    | /portal/dental/images/:imageId/link   | imageLink    | Portal | -    |     |                        |     | 60   |
| POST   | /portal/dental/plans/:planId/decision | decide       | Portal | -    |     | PatientPlanDecisionDto |     | 66   |

### apps/api/src/app/portal/portal-documents.controller.ts

| Method | Path                                                | Handler            | Auth   | Perm | Fac | DTO                     | Thr | Line |
| ------ | --------------------------------------------------- | ------------------ | ------ | ---- | --- | ----------------------- | --- | ---- |
| GET    | /portal/documents                                   | documents          | Portal | -    |     |                         |     | 37   |
| GET    | /portal/certificates/:certificateId/link            | certificateLink    | Portal | -    |     |                         |     | 73   |
| GET    | /portal/referrals/:referralId/link                  | referralLink       | Portal | -    |     |                         |     | 79   |
| POST   | /portal/records-requests                            | submit             | Portal | -    |     | SubmitRecordsRequestDto |     | 85   |
| POST   | /portal/records-requests/:requestId/withdraw        | withdraw           | Portal | -    |     |                         |     | 91   |
| GET    | /portal/records-requests/documents/:documentId/link | sharedDocumentLink | Portal | -    |     |                         |     | 98   |

### apps/api/src/app/portal/portal-forms.controller.ts

| Method | Path                          | Handler | Auth   | Perm | Fac | DTO               | Thr | Line |
| ------ | ----------------------------- | ------- | ------ | ---- | --- | ----------------- | --- | ---- |
| GET    | /portal/forms/count           | count   | Portal | -    |     |                   |     | 28   |
| GET    | /portal/forms                 | list    | Portal | -    |     |                   |     | 34   |
| POST   | /portal/forms/:requestId/sign | sign    | Portal | -    |     | PortalSignFormDto |     | 48   |

### apps/api/src/app/portal/portal-history.controller.ts

| Method | Path                                           | Handler        | Auth   | Perm | Fac | DTO                        | Thr                                        | Line |
| ------ | ---------------------------------------------- | -------------- | ------ | ---- | --- | -------------------------- | ------------------------------------------ | ---- |
| GET    | /portal/health-history                         | read           | Portal | -    |     |                            |                                            | 38   |
| POST   | /portal/health-history/submissions             | submit         | Portal | -    |     | PortalHistorySubmissionDto | { default: { limit: 10, ttl: 3_600_000 } } | 60   |
| POST   | /portal/health-history/medications/:id/stopped | stopMedication | Portal | -    |     | StopReportedMedicationDto  | { default: { limit: 20, ttl: 3_600_000 } } | 74   |

### apps/api/src/app/portal/portal-immunizations.controller.ts

| Method | Path                  | Handler | Auth   | Perm | Fac | DTO | Thr | Line |
| ------ | --------------------- | ------- | ------ | ---- | --- | --- | --- | ---- |
| GET    | /portal/immunizations | list    | Portal | -    |     |     |     | 26   |

### apps/api/src/app/portal/portal-messages.controller.ts

| Method | Path                             | Handler | Auth   | Perm | Fac | DTO | Thr | Line |
| ------ | -------------------------------- | ------- | ------ | ---- | --- | --- | --- | ---- |
| GET    | /portal/messages                 | list    | Portal | -    |     |     |     | 26   |
| GET    | /portal/messages/unread-count    | unread  | Portal | -    |     |     |     | 39   |
| POST   | /portal/messages/:messageId/read | read    | Portal | -    |     |     |     | 49   |

### apps/api/src/app/portal/portal-outside-results.controller.ts

| Method | Path                                                 | Handler        | Auth   | Perm | Fac | DTO                    | Thr                                     | Line |
| ------ | ---------------------------------------------------- | -------------- | ------ | ---- | --- | ---------------------- | --------------------------------------- | ---- |
| GET    | /portal/outside-results                              | list           | Portal | -    |     |                        |                                         | 23   |
| POST   | /portal/outside-results/uploads                      | startUpload    | Portal | -    |     | SubmissionUploadDto    | { default: { limit: 20, ttl: 60_000 } } | 29   |
| POST   | /portal/outside-results/uploads/:documentId/complete | completeUpload | Portal | -    |     |                        |                                         | 36   |
| POST   | /portal/outside-results                              | submit         | Portal | -    |     | SubmitOutsideResultDto | { default: { limit: 10, ttl: 60_000 } } | 43   |
| POST   | /portal/outside-results/:submissionId/withdraw       | withdraw       | Portal | -    |     |                        |                                         | 50   |
| GET    | /portal/outside-results/:submissionId/link           | link           | Portal | -    |     |                        |                                         | 57   |

### apps/api/src/app/portal/portal-push.controller.ts

| Method | Path                                        | Handler        | Auth   | Perm | Fac | DTO                     | Thr                                     | Line |
| ------ | ------------------------------------------- | -------------- | ------ | ---- | --- | ----------------------- | --------------------------------------- | ---- |
| GET    | /portal/push                                | status         | Portal | -    |     | q:PushStatusQueryDto    |                                         | 45   |
| POST   | /portal/push/subscriptions                  | register       | Portal | -    |     | RegisterDeviceDto       | { default: { limit: 20, ttl: 60_000 } } | 61   |
| POST   | /portal/push/mobile-devices                 | registerMobile | Portal | -    |     | RegisterMobileDeviceDto | { default: { limit: 20, ttl: 60_000 } } | 77   |
| POST   | /portal/push/subscriptions/:deviceId/remove | remove         | Portal | -    |     |                         |                                         | 93   |
| POST   | /portal/push/test                           | test           | Portal | -    |     |                         | { default: { limit: 5, ttl: 60_000 } }  | 106  |

### apps/api/src/app/portal/portal-qr.controller.ts

| Method | Path       | Handler | Auth   | Perm | Fac | DTO | Thr | Line |
| ------ | ---------- | ------- | ------ | ---- | --- | --- | --- | ---- |
| GET    | /portal/qr | mine    | Portal | -    |     |     |     | 20   |

### apps/api/src/app/portal/portal-records.controller.ts

| Method | Path                                       | Handler             | Auth   | Perm | Fac | DTO | Thr | Line |
| ------ | ------------------------------------------ | ------------------- | ------ | ---- | --- | --- | --- | ---- |
| GET    | /portal/privacy                            | privacyContact      | Portal | -    |     |     |     | 37   |
| GET    | /portal/appointments                       | appointments        | Portal | -    |     |     |     | 44   |
| GET    | /portal/results                            | results             | Portal | -    |     |     |     | 56   |
| GET    | /portal/results/orders/:orderId/report.pdf | labReport           | Portal | -    |     |     |     | 69   |
| GET    | /portal/results/trend                      | trend               | Portal | -    |     |     |     | 76   |
| GET    | /portal/prescriptions                      | activePrescriptions | Portal | -    |     |     |     | 89   |
| GET    | /portal/care-plans                         | carePlan            | Portal | -    |     |     |     | 126  |

### apps/api/src/app/portal/portal-teleconsult.controller.ts

| Method | Path                                              | Handler       | Auth   | Perm | Fac | DTO                | Thr | Line |
| ------ | ------------------------------------------------- | ------------- | ------ | ---- | --- | ------------------ | --- | ---- |
| GET    | /portal/teleconsults                              | list          | Portal | -    |     |                    |     | 22   |
| GET    | /portal/teleconsults/:appointmentId               | get           | Portal | -    |     |                    |     | 28   |
| PUT    | /portal/teleconsults/:appointmentId/questionnaire | questionnaire | Portal | -    |     | unknown            |     | 33   |
| GET    | /portal/teleconsults/:appointmentId/messages      | messages      | Portal | -    |     | q:MessagesQueryDto |     | 39   |
| POST   | /portal/teleconsults/:appointmentId/messages      | sendMessage   | Portal | -    |     | SendMessageDto     |     | 45   |
| POST   | /portal/teleconsults/:appointmentId/payment       | payment       | Portal | -    |     |                    |     | 51   |
| POST   | /portal/teleconsults/:appointmentId/waiting-room  | waitingRoom   | Portal | -    |     |                    |     | 61   |
| POST   | /portal/teleconsults/:appointmentId/video         | video         | Portal | -    |     |                    |     | 68   |

### apps/api/src/app/rate-limits.controller.ts

| Method | Path                  | Handler  | Auth  | Perm           | Fac | DTO                | Thr | Line |
| ------ | --------------------- | -------- | ----- | -------------- | --- | ------------------ | --- | ---- |
| GET    | /rate-limits/refusals | refusals | Staff | platform-admin |     | q:RefusalsQueryDto |     | 17   |

### apps/api/src/app/record-copy/record-copy.controller.ts

| Method | Path                                | Handler | Auth  | Perm                           | Fac | DTO                  | Thr | Line |
| ------ | ----------------------------------- | ------- | ----- | ------------------------------ | --- | -------------------- | --- | ---- |
| POST   | /records-requests/:requestId/copies | prepare | Staff | patient.records-request.manage |     | PrepareRecordCopyDto |     | 14   |

### apps/api/src/app/staff-push.controller.ts

| Method | Path                                    | Handler        | Auth  | Perm | Fac | DTO                       | Thr                                     | Line |
| ------ | --------------------------------------- | -------------- | ----- | ---- | --- | ------------------------- | --------------------------------------- | ---- |
| GET    | /me/push                                | status         | Staff | -    |     | q:StaffPushStatusQueryDto |                                         | 38   |
| PUT    | /me/push/preferences                    | setPreferences | Staff | -    |     | StaffPushPreferencesDto   |                                         | 53   |
| POST   | /me/push/subscriptions                  | register       | Staff | -    |     | RegisterStaffDeviceDto    | { default: { limit: 20, ttl: 60_000 } } | 66   |
| POST   | /me/push/subscriptions/:deviceId/remove | remove         | Staff | -    |     |                           |                                         | 81   |
| POST   | /me/push/test                           | test           | Staff | -    |     |                           | { default: { limit: 5, ttl: 60_000 } }  | 89   |

### libs/audit/src/lib/audit.controller.ts

| Method | Path          | Handler | Auth  | Perm       | Fac | DTO             | Thr | Line |
| ------ | ------------- | ------- | ----- | ---------- | --- | --------------- | --- | ---- |
| GET    | /audit-events | list    | Staff | audit.read |     | q:AuditQueryDto |     | 24   |

### libs/auth/src/lib/auth.controller.ts

| Method | Path                         | Handler              | Auth   | Perm | Fac | DTO                          | Thr                 | Line |
| ------ | ---------------------------- | -------------------- | ------ | ---- | --- | ---------------------------- | ------------------- | ---- |
| POST   | /auth/realtime-tickets       | realtimeTicket       | Staff  | -    | Y   |                              |                     | 49   |
| POST   | /auth/login                  | login                | PUBLIC | -    |     | LoginDto                     | CREDENTIAL_THROTTLE | 61   |
| POST   | /auth/password-reset/request | requestPasswordReset | PUBLIC | -    |     | StaffPasswordResetRequestDto | CREDENTIAL_THROTTLE | 71   |
| POST   | /auth/password-reset         | resetPassword        | PUBLIC | -    |     | StaffPasswordResetDto        | CREDENTIAL_THROTTLE | 81   |
| POST   | /auth/mfa/verify             | verifyMfa            | PUBLIC | -    |     | MfaVerifyDto                 | CREDENTIAL_THROTTLE | 91   |
| POST   | /auth/refresh                | refresh              | PUBLIC | -    |     | RefreshDto                   | CREDENTIAL_THROTTLE | 101  |
| POST   | /auth/logout                 | logout               | Staff  | -    |     |                              |                     | 111  |
| GET    | /auth/me                     | me                   | Staff  | -    |     |                              |                     | 119  |
| GET    | /auth/me/facilities          | myFacilities         | Staff  | -    |     |                              |                     | 148  |
| POST   | /auth/password               | changePassword       | Staff  | -    |     | ChangePasswordDto            | CREDENTIAL_THROTTLE | 170  |
| POST   | /auth/mfa/setup              | setupMfa             | Staff  | -    |     |                              |                     | 180  |
| POST   | /auth/mfa/confirm            | confirmMfa           | Staff  | -    |     | MfaConfirmDto                | CREDENTIAL_THROTTLE | 188  |
| POST   | /auth/mfa/recovery-codes     | renewRecoveryCodes   | Staff  | -    |     | RecoveryCodesRenewDto        | CREDENTIAL_THROTTLE | 198  |
| POST   | /auth/mfa/disable            | disableMfa           | Staff  | -    |     | MfaDisableDto                | CREDENTIAL_THROTTLE | 207  |

### libs/auth/src/lib/mfa-policy.controller.ts

| Method | Path                         | Handler         | Auth  | Perm            | Fac | DTO             | Thr | Line |
| ------ | ---------------------------- | --------------- | ----- | --------------- | --- | --------------- | --- | ---- |
| GET    | /security/mfa-policy         | view            | Staff | user.read       |     |                 |     | 13   |
| PUT    | /security/mfa-policy         | update          | Staff | user.mfa.manage |     | MfaPolicyDto    |     | 20   |
| PUT    | /users/:userId/mfa-exemption | exempt          | Staff | user.mfa.manage |     | MfaExemptionDto |     | 27   |
| DELETE | /users/:userId/mfa-exemption | removeExemption | Staff | user.mfa.manage |     |                 |     | 34   |
| POST   | /users/:userId/mfa-reset     | reset           | Staff | user.mfa.manage |     | MfaResetDto     |     | 40   |

### libs/auth/src/lib/users.controller.ts

| Method | Path                                          | Handler          | Auth  | Perm        | Fac | DTO                 | Thr | Line |
| ------ | --------------------------------------------- | ---------------- | ----- | ----------- | --- | ------------------- | --- | ---- |
| GET    | /users                                        | list             | Staff | user.read   |     |                     |     | 13   |
| POST   | /users                                        | create           | Staff | user.manage |     | CreateUserDto       |     | 19   |
| GET    | /users/:userId                                | get              | Staff | user.read   |     |                     |     | 26   |
| PATCH  | /users/:userId/membership                     | updateMembership | Staff | user.manage |     | UpdateMembershipDto |     | 32   |
| POST   | /users/:userId/password-reset                 | resetPassword    | Staff | user.manage |     | ResetPasswordDto    |     | 39   |
| POST   | /users/:userId/role-assignments               | grantRole        | Staff | user.manage |     | GrantRoleDto        |     | 50   |
| DELETE | /users/:userId/role-assignments/:assignmentId | revokeRole       | Staff | user.manage |     |                     |     | 56   |
| GET    | /roles                                        | listRoles        | Staff | user.read   |     |                     |     | 67   |
| POST   | /roles                                        | createRole       | Staff | role.manage |     | CreateRoleDto       |     | 73   |
| PUT    | /roles/:roleId                                | updateRole       | Staff | role.manage |     | UpdateRoleDto       |     | 79   |
| GET    | /permissions                                  | listPermissions  | Staff | user.read   |     |                     |     | 86   |

### libs/billing/src/lib/billing.controllers.ts

| Method | Path                                                       | Handler                | Auth   | Perm                      | Fac | DTO                   | Thr | Line |
| ------ | ---------------------------------------------------------- | ---------------------- | ------ | ------------------------- | --- | --------------------- | --- | ---- |
| GET    | /billing/tax-profile                                       | taxProfile             | Staff  | billing.charge.read       |     |                       |     | 71   |
| PUT    | /billing/tax-profile                                       | updateTaxProfile       | Staff  | billing.pricelist.manage  |     | UpdateTaxProfileDto   |     | 78   |
| GET    | /billing/packages                                          | packages_              | Staff  | billing.charge.read       |     |                       |     | 85   |
| POST   | /billing/packages                                          | createPackage          | Staff  | billing.pricelist.manage  |     | CreatePackageDto      |     | 92   |
| GET    | /billing/services                                          | services               | Staff  | billing.charge.read       |     |                       |     | 99   |
| POST   | /billing/services                                          | createService          | Staff  | billing.pricelist.manage  |     | CreateServiceDto      |     | 105  |
| PATCH  | /billing/services/:serviceId                               | updateService          | Staff  | billing.pricelist.manage  |     | UpdateServiceDto      |     | 112  |
| POST   | /billing/services/:serviceId/prices                        | addPrice               | Staff  | billing.pricelist.manage  |     | AddPriceDto           |     | 118  |
| GET    | /billing/payers                                            | payers                 | Staff  | billing.charge.read       |     |                       |     | 125  |
| POST   | /billing/payers                                            | createPayer            | Staff  | billing.pricelist.manage  |     | CreatePayerDto        |     | 131  |
| GET    | /billing/discount-rules                                    | discountRules          | Staff  | billing.charge.read       |     |                       |     | 137  |
| POST   | /billing/discount-rules                                    | createDiscountRule     | Staff  | billing.pricelist.manage  |     | CreateDiscountRuleDto |     | 143  |
| POST   | /billing/discount-rules/:ruleId/deactivate                 | deactivateDiscountRule | Staff  | billing.pricelist.manage  |     |                       |     | 150  |
| GET    | /billing/settings                                          | settings               | Staff  | billing.charge.read       |     |                       |     | 157  |
| PUT    | /billing/settings                                          | updateSettings         | Staff  | billing.pricelist.manage  |     | UpdateSettingsDto     |     | 163  |
| GET    | /billing/worklist                                          | worklist               | Staff  | billing.charge.read       | Y   |                       |     | 188  |
| GET    | /billing/charges                                           | charges_               | Staff  | billing.charge.read       | Y   | q:ListChargesDto      |     | 195  |
| POST   | /billing/charges                                           | addCharge              | Staff  | billing.charge.capture    | Y   | ManualChargeDto       |     | 201  |
| POST   | /billing/charges/:chargeId/cancel                          | cancelCharge           | Staff  | billing.charge.capture    | Y   | CancelChargeDto       |     | 208  |
| GET    | /billing/invoices                                          | invoices_              | Staff  | billing.charge.read       | Y   | q:ListInvoicesDto     |     | 215  |
| POST   | /billing/invoices                                          | createInvoice          | Staff  | billing.invoice.issue     | Y   | CreateInvoiceDto      |     | 221  |
| GET    | /billing/invoices/:invoiceId                               | invoice                | Staff  | billing.charge.read       | Y   |                       |     | 228  |
| DELETE | /billing/invoices/:invoiceId/items/:itemId                 | removeItem             | Staff  | billing.invoice.issue     | Y   | q:RemoveLineDto       |     | 234  |
| POST   | /billing/invoices/:invoiceId/discounts                     | applyDiscount          | Staff  | billing.discount.apply    | Y   | ApplyDiscountDto      |     | 245  |
| DELETE | /billing/invoices/:invoiceId/discounts/:discountId         | removeDiscount         | Staff  | billing.discount.apply    | Y   | q:RemoveLineDto       |     | 251  |
| POST   | /billing/invoices/:invoiceId/payers                        | setPayer               | Staff  | billing.invoice.issue     | Y   | SetPayerDto           |     | 262  |
| DELETE | /billing/invoices/:invoiceId/payers/:invoicePayerId        | removePayer            | Staff  | billing.invoice.issue     | Y   | q:RemoveLineDto       |     | 269  |
| POST   | /billing/invoices/:invoiceId/payers/:invoicePayerId/status | payerStatus            | Staff  | billing.invoice.issue     | Y   | PayerStatusDto        |     | 280  |
| POST   | /billing/invoices/:invoiceId/discard                       | discard                | Staff  | billing.invoice.issue     | Y   | IssueInvoiceDto       |     | 293  |
| POST   | /billing/invoices/:invoiceId/issue                         | issue                  | Staff  | billing.invoice.issue     | Y   | IssueInvoiceDto       |     | 300  |
| POST   | /billing/invoices/:invoiceId/void                          | void                   | Staff  | billing.invoice.void      | Y   | VoidInvoiceDto        |     | 308  |
| GET    | /billing/invoices/:invoiceId/pdf                           | invoicePdf             | Staff  | billing.charge.read       | Y   |                       |     | 316  |
| GET    | /billing/payments/:paymentId/receipt.pdf                   | receiptPdf             | Staff  | billing.charge.read       | Y   |                       |     | 324  |
| POST   | /billing/invoices/:invoiceId/payments                      | pay                    | Staff  | billing.payment.record    | Y   | RecordPaymentDto      |     | 332  |
| POST   | /billing/payments/:paymentId/refund                        | refund                 | Staff  | billing.refund.issue      | Y   | RefundDto             |     | 339  |
| GET    | /billing/patients/:patientId/account                       | account                | Staff  | billing.charge.read       | Y   |                       |     | 348  |
| POST   | /billing/patients/:patientId/deposits                      | deposit                | Staff  | billing.deposit.record    | Y   | RecordDepositDto      |     | 355  |
| POST   | /billing/patients/:patientId/account-refunds               | refundAccount          | Staff  | billing.refund.issue      | Y   | RefundAccountDto      |     | 362  |
| GET    | /billing/account-entries/:entryId/receipt.pdf              | depositReceiptPdf      | Staff  | billing.charge.read       | Y   |                       |     | 369  |
| POST   | /billing/invoices/:invoiceId/deposit-applications          | applyDeposit           | Staff  | billing.deposit.record    | Y   | ApplyDepositDto       |     | 377  |
| POST   | /billing/invoices/:invoiceId/credit-notes                  | issueCreditNote        | Staff  | billing.credit-note.issue | Y   | IssueCreditNoteDto    |     | 386  |
| GET    | /billing/credit-notes/:creditNoteId                        | creditNote             | Staff  | billing.charge.read       | Y   |                       |     | 393  |
| GET    | /billing/credit-notes/:creditNoteId/pdf                    | creditNotePdf          | Staff  | billing.charge.read       | Y   |                       |     | 399  |
| GET    | /billing/patients/:patientId/packages                      | patientPackages        | Staff  | billing.charge.read       | Y   |                       |     | 409  |
| POST   | /billing/patients/:patientId/packages                      | sellPackage            | Staff  | billing.charge.capture    | Y   | SellPackageDto        |     | 416  |
| POST   | /billing/package-enrollments/:enrollmentId/cancel          | cancelPackage          | Staff  | billing.charge.capture    | Y   | CancelEnrollmentDto   |     | 423  |
| POST   | /billing/invoices/:invoiceId/debit-notes                   | issueDebitNote         | Staff  | billing.debit-note.issue  | Y   | IssueDebitNoteDto     |     | 433  |
| GET    | /billing/debit-notes/:debitNoteId                          | debitNote              | Staff  | billing.charge.read       | Y   |                       |     | 440  |
| GET    | /billing/debit-notes/:debitNoteId/pdf                      | debitNotePdf           | Staff  | billing.charge.read       | Y   |                       |     | 446  |
| GET    | /billing/reports/daily                                     | daily                  | Staff  | billing.report.read       | Y   | q:DailyReportDto      |     | 454  |
| POST   | /billing/online-payments/notifications                     | notify                 | PUBLIC | -                         |     |                       |     | 474  |

### libs/care-plan/src/lib/care-plan.controller.ts

| Method | Path                                           | Handler        | Auth  | Perm             | Fac | DTO                 | Thr | Line |
| ------ | ---------------------------------------------- | -------------- | ----- | ---------------- | --- | ------------------- | --- | ---- |
| POST   | /care-plans                                    | create         | Staff | care-plan.manage |     | CreateCarePlanDto   |     | 23   |
| GET    | /care-plans                                    | list           | Staff | care-plan.read   |     | q:ListCarePlansDto  |     | 30   |
| GET    | /care-plans/activities/due                     | due            | Staff | care-plan.read   |     | q:DueActivitiesDto  |     | 36   |
| GET    | /care-plans/:carePlanId                        | get            | Staff | care-plan.read   |     |                     |     | 43   |
| POST   | /care-plans/:carePlanId/status                 | status         | Staff | care-plan.manage |     | ChangePlanStatusDto |     | 49   |
| POST   | /care-plans/:carePlanId/goals                  | addGoal        | Staff | care-plan.manage |     | AddGoalDto          |     | 56   |
| PATCH  | /care-plans/:carePlanId/goals/:goalId          | updateGoal     | Staff | care-plan.manage |     | UpdateGoalDto       |     | 62   |
| POST   | /care-plans/:carePlanId/activities             | addActivity    | Staff | care-plan.manage |     | AddActivityDto      |     | 73   |
| PATCH  | /care-plans/:carePlanId/activities/:activityId | updateActivity | Staff | care-plan.manage |     | UpdateActivityDto   |     | 79   |
| POST   | /care-plans/:carePlanId/progress-notes         | progressNote   | Staff | care-plan.manage |     | ProgressNoteDto     |     | 91   |

### libs/clinic/src/lib/calendar/calendar.controller.ts

| Method | Path                             | Handler | Auth  | Perm            | Fac | DTO                    | Thr | Line |
| ------ | -------------------------------- | ------- | ----- | --------------- | --- | ---------------------- | --- | ---- |
| GET    | /calendar/events                 | list    | Staff | calendar.read   |     | q:CalendarRangeDto     |     | 13   |
| POST   | /calendar/events                 | create  | Staff | calendar.manage |     | CreateCalendarEventDto |     | 20   |
| GET    | /calendar/events/:eventId        | get     | Staff | calendar.read   |     |                        |     | 27   |
| PUT    | /calendar/events/:eventId        | update  | Staff | calendar.manage |     | UpdateCalendarEventDto |     | 33   |
| POST   | /calendar/events/:eventId/cancel | cancel  | Staff | calendar.manage |     | CancelCalendarEventDto |     | 40   |

### libs/clinic/src/lib/certificates/medical-certificate.controller.ts

| Method | Path                                                 | Handler | Auth  | Perm           | Fac | DTO                 | Thr | Line |
| ------ | ---------------------------------------------------- | ------- | ----- | -------------- | --- | ------------------- | --- | ---- |
| GET    | /encounters/:encounterId/certificates                | list    | Staff | encounter.read |     |                     |     | 13   |
| POST   | /encounters/:encounterId/certificates                | issue   | Staff | encounter.sign |     | IssueCertificateDto |     | 20   |
| GET    | /medical-certificates/:certificateId                 | get     | Staff | encounter.read |     |                     |     | 27   |
| GET    | /medical-certificates/:certificateId/certificate.pdf | pdf     | Staff | encounter.read |     |                     |     | 33   |
| POST   | /medical-certificates/:certificateId/void            | void    | Staff | encounter.read |     | VoidCertificateDto  |     | 41   |

### libs/clinic/src/lib/clinic.controllers.ts

| Method | Path                                                   | Handler                    | Auth  | Perm                  | Fac | DTO                            | Thr | Line |
| ------ | ------------------------------------------------------ | -------------------------- | ----- | --------------------- | --- | ------------------------------ | --- | ---- |
| GET    | /clinic/service-points                                 | listServicePoints          | Staff | clinic.queue.read     |     | q:ServicePointsQueryDto        |     | 100  |
| POST   | /clinic/service-points                                 | createServicePoint         | Staff | clinic.configure      |     | CreateServicePointDto          |     | 107  |
| PATCH  | /clinic/service-points/:servicePointId                 | updateServicePoint         | Staff | clinic.configure      |     | UpdateServicePointDto          |     | 114  |
| GET    | /clinic/service-point-settings                         | servicePointSettings       | Staff | clinic.queue.read     |     | q:ServicePointSettingsQueryDto |     | 121  |
| PUT    | /clinic/service-point-settings                         | updateServicePointSettings | Staff | clinic.configure      |     | UpdateServicePointSettingsDto  |     | 128  |
| GET    | /clinic/route-templates                                | listRouteTemplates         | Staff | clinic.queue.read     |     | q:RouteTemplatesQueryDto       |     | 137  |
| POST   | /clinic/route-templates                                | createRouteTemplate        | Staff | clinic.configure      |     | CreateRouteTemplateDto         |     | 146  |
| PATCH  | /clinic/route-templates/:routeTemplateId               | updateRouteTemplate        | Staff | clinic.configure      |     | UpdateRouteTemplateDto         |     | 153  |
| GET    | /clinic/waitlist-rules                                 | listWaitlistRules          | Staff | appointment.read      |     | q:WaitlistRulesQueryDto        |     | 163  |
| PUT    | /clinic/waitlist-rules                                 | upsertWaitlistRule         | Staff | clinic.configure      |     | UpsertWaitlistRuleDto          |     | 170  |
| GET    | /clinic/booking-rules                                  | listBookingRules           | Staff | appointment.read      |     |                                |     | 179  |
| PUT    | /clinic/booking-rules/:facilityId                      | updateBookingRules         | Staff | clinic.configure      |     | UpdateBookingRulesDto          |     | 186  |
| GET    | /clinic/practitioners                                  | practitioners              | Staff | appointment.read      |     |                                |     | 193  |
| POST   | /clinic/practitioners                                  | createPractitioner         | Staff | clinic.configure      |     | CreatePractitionerDto          |     | 199  |
| PATCH  | /clinic/practitioners/:practitionerId                  | updatePractitioner         | Staff | clinic.configure      |     | UpdatePractitionerDto          |     | 205  |
| GET    | /clinic/rooms                                          | rooms                      | Staff | appointment.read      |     | q:FacilityQueryDto             |     | 211  |
| POST   | /clinic/rooms                                          | createRoom                 | Staff | clinic.configure      |     | CreateRoomDto                  |     | 217  |
| GET    | /clinic/visit-types                                    | visitTypes                 | Staff | appointment.read      |     |                                |     | 223  |
| POST   | /clinic/visit-types                                    | createVisitType            | Staff | clinic.configure      |     | CreateVisitTypeDto             |     | 229  |
| PATCH  | /clinic/visit-types/:visitTypeId                       | updateVisitType            | Staff | clinic.configure      |     | UpdateVisitTypeDto             |     | 235  |
| GET    | /clinic/coding-systems                                 | codingSystems              | Staff | encounter.read        |     |                                |     | 242  |
| POST   | /clinic/coding-systems                                 | createCodingSystem         | Staff | clinic.configure      |     | CreateCodingSystemDto          |     | 248  |
| PATCH  | /clinic/coding-systems/:codingSystemId                 | updateCodingSystem         | Staff | clinic.configure      |     | UpdateCodingSystemDto          |     | 255  |
| GET    | /clinic/schedules                                      | schedules                  | Staff | appointment.read      |     | q:ScheduleQueryDto             |     | 262  |
| POST   | /clinic/schedules                                      | createSchedule             | Staff | clinic.configure      |     | CreateScheduleDto              |     | 268  |
| POST   | /clinic/schedules/:scheduleId/retire                   | retireSchedule             | Staff | clinic.configure      |     |                                |     | 274  |
| GET    | /clinic/schedule-exceptions                            | exceptions                 | Staff | appointment.read      |     | q:ExceptionsQueryDto           |     | 281  |
| POST   | /clinic/schedule-exceptions                            | createException            | Staff | clinic.configure      |     | CreateExceptionDto             |     | 287  |
| GET    | /appointments/availability                             | availability               | Staff | appointment.read      |     | q:AvailabilityQueryDto         |     | 305  |
| GET    | /appointments                                          | list                       | Staff | appointment.read      |     | q:ListAppointmentsDto          |     | 311  |
| POST   | /appointments                                          | book                       | Staff | appointment.manage    |     | BookAppointmentDto             |     | 317  |
| GET    | /appointments/:appointmentId                           | get                        | Staff | appointment.read      |     |                                |     | 325  |
| POST   | /appointments/:appointmentId/confirm                   | confirm                    | Staff | appointment.manage    |     | VersionOnlyDto                 |     | 331  |
| POST   | /appointments/:appointmentId/reschedule                | reschedule                 | Staff | appointment.manage    |     | RescheduleDto                  |     | 338  |
| POST   | /appointments/:appointmentId/cancel                    | cancel                     | Staff | appointment.manage    |     | CancelAppointmentDto           |     | 345  |
| POST   | /appointments/:appointmentId/no-show                   | noShow                     | Staff | appointment.manage    |     | VersionOnlyDto                 |     | 352  |
| POST   | /appointments/:appointmentId/check-in                  | checkIn                    | Staff | clinic.queue.manage   | Y   | CheckInDto                     |     | 359  |
| GET    | /waitlist                                              | waitlist                   | Staff | appointment.read      |     | q:FacilityQueryDto             |     | 367  |
| POST   | /waitlist                                              | addToWaitlist              | Staff | appointment.manage    |     | CreateWaitlistDto              |     | 373  |
| POST   | /waitlist/:entryId/close                               | closeWaitlist              | Staff | appointment.manage    |     | CloseWaitlistDto               |     | 379  |
| GET    | /waitlist/offers                                       | offers                     | Staff | appointment.read      |     | q:WaitlistOffersQueryDto       |     | 388  |
| POST   | /waitlist/offers/:offerId/accept                       | acceptOffer                | Staff | appointment.manage    |     |                                |     | 395  |
| POST   | /waitlist/offers/:offerId/withdraw                     | withdrawOffer              | Staff | appointment.manage    |     | WithdrawOfferDto               |     | 403  |
| GET    | /queue                                                 | queue                      | Staff | clinic.queue.read     | Y   | q:QueueQueryDto                |     | 422  |
| GET    | /queue/display                                         | display                    | Staff | clinic.queue.display  | Y   |                                |     | 430  |
| POST   | /queue/walk-ins                                        | walkIn                     | Staff | clinic.queue.manage   | Y   | WalkInDto                      |     | 438  |
| GET    | /queue/visits/:visitId                                 | get                        | Staff | clinic.queue.read     |     |                                |     | 446  |
| POST   | /queue/visits/:visitId/move                            | move                       | Staff | clinic.queue.manage   |     | MoveVisitDto                   |     | 452  |
| POST   | /queue/visits/:visitId/call                            | call                       | Staff | clinic.queue.manage   |     | CallVisitDto                   |     | 459  |
| POST   | /queue/visits/:visitId/route                           | route                      | Staff | clinic.queue.manage   |     | RouteVisitDto                  |     | 466  |
| GET    | /queue/visits/:visitId/routing                         | routing                    | Staff | clinic.queue.read     |     |                                |     | 474  |
| GET    | /queue/visits/:visitId/route                           | routePlan                  | Staff | clinic.queue.read     |     |                                |     | 483  |
| PUT    | /queue/visits/:visitId/route-plan                      | planRoute                  | Staff | clinic.queue.manage   |     | PlanRouteDto                   |     | 490  |
| POST   | /queue/visits/:visitId/route/next                      | advanceRoute               | Staff | clinic.queue.manage   |     | AdvanceRouteDto                |     | 497  |
| POST   | /queue/visits/:visitId/route/skip                      | skipRouteStep              | Staff | clinic.queue.manage   |     | SkipRouteStepDto               |     | 507  |
| POST   | /queue/visits/:visitId/assign                          | assign                     | Staff | clinic.queue.manage   |     | AssignVisitDto                 |     | 515  |
| POST   | /queue/visits/:visitId/triage                          | recordTriage               | Staff | clinic.triage.write   |     | TriageDto                      |     | 522  |
| POST   | /vital-signs                                           | recordVitals               | Staff | clinic.triage.write   |     | RecordVitalsDto                |     | 536  |
| GET    | /vital-signs                                           | vitals                     | Staff | clinical.read         |     | q:PatientQueryDto              |     | 542  |
| POST   | /vital-signs/:vitalsId/entered-in-error                | vitalsInError              | Staff | clinic.triage.write   |     | EnteredInErrorDto              |     | 549  |
| GET    | /patients/:patientId/allergies                         | allergies                  | Staff | clinical.read         |     |                                |     | 556  |
| POST   | /patients/:patientId/allergies                         | addAllergy                 | Staff | allergy.manage        |     | CreateAllergyDto               |     | 562  |
| PATCH  | /patients/:patientId/allergies/:allergyId              | updateAllergy              | Staff | allergy.manage        |     | UpdateAllergyStatusDto         |     | 568  |
| POST   | /patients/:patientId/allergy-reviews                   | reviewAllergies            | Staff | allergy.manage        |     | AllergyReviewDto               |     | 579  |
| POST   | /encounters                                            | start                      | Staff | encounter.write       |     | StartEncounterDto              |     | 593  |
| GET    | /encounters                                            | list                       | Staff | encounter.read        |     | q:ListEncountersDto            |     | 600  |
| GET    | /encounters/:encounterId                               | get                        | Staff | encounter.read        |     |                                |     | 606  |
| GET    | /encounters/:encounterId/revisions                     | revisions                  | Staff | encounter.read        |     |                                |     | 612  |
| PUT    | /encounters/:encounterId/note                          | saveNote                   | Staff | encounter.write       |     | SaveNoteDto                    |     | 619  |
| POST   | /encounters/:encounterId/sign                          | sign                       | Staff | encounter.sign        |     | SignEncounterDto               |     | 625  |
| POST   | /encounters/:encounterId/amendments                    | amend                      | Staff | encounter.amend       |     | AmendNoteDto                   |     | 632  |
| POST   | /encounters/:encounterId/entered-in-error              | enteredInError             | Staff | encounter.write       |     | EnteredInErrorDto              |     | 638  |
| POST   | /encounters/:encounterId/diagnoses                     | addDiagnosis               | Staff | encounter.write       |     | AddDiagnosisDto                |     | 645  |
| POST   | /encounters/:encounterId/diagnoses/:diagnosisId/status | diagnosisStatus            | Staff | encounter.write       |     | UpdateDiagnosisStatusDto       |     | 651  |
| GET    | /clinic/dashboard                                      | get                        | Staff | clinic.dashboard.read | Y   | q:DashboardQueryDto            |     | 670  |
| GET    | /clinic/dashboard/load                                 | load                       | Staff | clinic.dashboard.read | Y   | q:DashboardLoadQueryDto        |     | 677  |

### libs/clinic/src/lib/external/external-history.controller.ts

| Method | Path                                                            | Handler        | Auth  | Perm                       | Fac | DTO               | Thr | Line |
| ------ | --------------------------------------------------------------- | -------------- | ----- | -------------------------- | --- | ----------------- | --- | ---- |
| GET    | /patients/:patientId/external-history                           | list           | Staff | clinical.read              |     |                   |     | 13   |
| POST   | /patients/:patientId/external-history/:entryId/entered-in-error | enteredInError | Staff | interop.fhir.import.review |     | EnteredInErrorDto |     | 20   |

### libs/clinic/src/lib/history/history.controller.ts

| Method | Path                                       | Handler        | Auth  | Perm           | Fac | DTO                         | Thr | Line |
| ------ | ------------------------------------------ | -------------- | ----- | -------------- | --- | --------------------------- | --- | ---- |
| GET    | /patients/:patientId/history               | read           | Staff | history.read   |     |                             |     | 27   |
| POST   | /patients/:patientId/history/procedures    | procedure      | Staff | history.record |     | RecordPastProcedureDto      |     | 34   |
| POST   | /patients/:patientId/history/conditions    | condition      | Staff | history.record |     | RecordPastConditionDto      |     | 41   |
| POST   | /patients/:patientId/history/medications   | medication     | Staff | history.record |     | RecordReportedMedicationDto |     | 48   |
| POST   | /history/medications/:entryId/stopped      | stopMedication | Staff | history.record |     | StopReportedMedicationDto   |     | 57   |
| POST   | /patients/:patientId/history/family        | family         | Staff | history.record |     | RecordFamilyHistoryDto      |     | 65   |
| POST   | /patients/:patientId/history/family/review | review         | Staff | history.record |     | FamilyReviewDto             |     | 72   |
| POST   | /patients/:patientId/history/social        | social         | Staff | history.record |     | RecordSocialHistoryDto      |     | 80   |
| POST   | /history/:entryId/entered-in-error         | enteredInError | Staff | history.record |     | HistoryInErrorDto           |     | 87   |

### libs/clinic/src/lib/immunizations/immunization.controller.ts

| Method | Path                                            | Handler            | Auth  | Perm                | Fac | DTO                     | Thr | Line |
| ------ | ----------------------------------------------- | ------------------ | ----- | ------------------- | --- | ----------------------- | --- | ---- |
| GET    | /immunizations/catalog                          | catalog            | Staff | immunization.read   |     | q:VaccineListQueryDto   |     | 21   |
| POST   | /immunizations/catalog                          | addVaccine         | Staff | clinic.configure    |     | CreateVaccineDto        |     | 28   |
| PATCH  | /immunizations/catalog/:vaccineId               | updateVaccine      | Staff | clinic.configure    |     | UpdateVaccineDto        |     | 35   |
| GET    | /immunizations/stock                            | stock              | Staff | immunization.record | Y   |                         |     | 41   |
| GET    | /patients/:patientId/immunizations              | list               | Staff | immunization.read   |     |                         |     | 49   |
| POST   | /patients/:patientId/immunizations              | recordAdministered | Staff | immunization.record | Y   | RecordAdministeredDto   |     | 56   |
| POST   | /patients/:patientId/immunizations/historical   | recordHistorical   | Staff | immunization.record |     | RecordHistoricalDto     |     | 64   |
| GET    | /encounters/:encounterId/immunizations          | forEncounter       | Staff | immunization.read   |     |                         |     | 71   |
| POST   | /immunizations/:immunizationId/reaction         | reaction           | Staff | immunization.record |     | ImmunizationReactionDto |     | 77   |
| POST   | /immunizations/:immunizationId/entered-in-error | enteredInError     | Staff | immunization.record |     | ImmunizationInErrorDto  |     | 85   |

### libs/clinic/src/lib/outside-results/outside-result-submission.controller.ts

| Method | Path                                              | Handler | Auth  | Perm                             | Fac | DTO                  | Thr | Line |
| ------ | ------------------------------------------------- | ------- | ----- | -------------------------------- | --- | -------------------- | --- | ---- |
| GET    | /outside-result-submissions                       | queue   | Staff | outside-result.submission.manage |     |                      |     | 14   |
| GET    | /outside-result-submissions/:submissionId/link    | link    | Staff | outside-result.submission.manage |     |                      |     | 21   |
| POST   | /outside-result-submissions/:submissionId/file    | file    | Staff | outside-result.submission.manage |     | FileSubmissionDto    |     | 28   |
| POST   | /outside-result-submissions/:submissionId/decline | decline | Staff | outside-result.submission.manage |     | DeclineSubmissionDto |     | 36   |

### libs/clinic/src/lib/outside-results/outside-result.controller.ts

| Method | Path                                               | Handler        | Auth  | Perm                  | Fac | DTO                     | Thr | Line |
| ------ | -------------------------------------------------- | -------------- | ----- | --------------------- | --- | ----------------------- | --- | ---- |
| GET    | /patients/:patientId/outside-results               | list           | Staff | outside-result.read   |     |                         |     | 13   |
| POST   | /patients/:patientId/outside-results               | record         | Staff | outside-result.record |     | RecordOutsideResultDto  |     | 20   |
| GET    | /outside-results/unreviewed                        | unreviewed     | Staff | outside-result.review |     |                         |     | 27   |
| POST   | /outside-results/:outsideResultId/review           | review         | Staff | outside-result.review |     | ReviewOutsideResultDto  |     | 34   |
| GET    | /outside-results/:outsideResultId/download-url     | downloadUrl    | Staff | outside-result.read   |     |                         |     | 42   |
| POST   | /outside-results/:outsideResultId/entered-in-error | enteredInError | Staff | outside-result.record |     | OutsideResultInErrorDto |     | 49   |

### libs/clinic/src/lib/procedures/procedure.controller.ts

| Method | Path                                                          | Handler                | Auth  | Perm                           | Fac | DTO                               | Thr | Line |
| ------ | ------------------------------------------------------------- | ---------------------- | ----- | ------------------------------ | --- | --------------------------------- | --- | ---- |
| GET    | /clinic/procedure-definitions                                 | catalog                | Staff | encounter.read                 |     | q:ProcedureDefinitionListQueryDto |     | 36   |
| POST   | /clinic/procedure-definitions                                 | addDefinition          | Staff | clinic.configure               |     | CreateProcedureDefinitionDto      |     | 43   |
| PATCH  | /clinic/procedure-definitions/:definitionId                   | updateDefinition       | Staff | clinic.configure               |     | UpdateProcedureDefinitionDto      |     | 50   |
| GET    | /clinic/procedure-definitions/:definitionId/consent-wordings  | consentWordings        | Staff | encounter.read                 |     |                                   |     | 58   |
| POST   | /clinic/procedure-definitions/:definitionId/consent-wordings  | publishConsentWording  | Staff | clinic.configure               |     | PublishConsentWordingDto          |     | 65   |
| GET    | /clinic/consent-signing/settings                              | signingSettings        | Staff | encounter.read                 |     |                                   |     | 72   |
| PUT    | /clinic/consent-signing/settings                              | updateSigningSettings  | Staff | clinic.configure               |     | UpdateSigningSettingDto           |     | 79   |
| POST   | /patients/:patientId/consent-signature-requests               | requestSignature       | Staff | procedure.record, patient.read | Y   | CreateSignatureRequestDto         |     | 86   |
| GET    | /patients/:patientId/consent-signature-requests               | signatureRequests      | Staff | encounter.read, patient.read   |     |                                   |     | 94   |
| POST   | /consent-signature-requests/:requestId/cancel                 | cancelSignatureRequest | Staff | procedure.record               |     | CancelSignatureRequestDto         |     | 101  |
| POST   | /clinic/procedure-definitions/:definitionId/consent-form/sign | signConsentForm        | Staff | procedure.record, patient.read | Y   | SignConsentFormDto                |     | 109  |
| GET    | /clinic/procedure-definitions/:definitionId/consent-form.pdf  | consentForm            | Staff | encounter.read, patient.read   | Y   | q:ConsentFormQueryDto             |     | 126  |
| GET    | /encounters/:encounterId/procedures                           | forEncounter           | Staff | encounter.read                 |     |                                   |     | 139  |
| POST   | /encounters/:encounterId/procedures                           | record                 | Staff | encounter.write                | Y   | RecordProcedureDto                |     | 145  |
| GET    | /visits/:visitId/procedures                                   | forVisit               | Staff | encounter.read                 |     |                                   |     | 153  |
| POST   | /visits/:visitId/procedures                                   | recordForVisit         | Staff | procedure.record               | Y   | RecordVisitProcedureDto           |     | 160  |
| POST   | /procedures/:procedureId/consent                              | addConsent             | Staff | encounter.read                 |     | ProcedureConsentDto               |     | 170  |
| GET    | /patients/:patientId/procedures                               | forPatient             | Staff | encounter.read                 |     |                                   |     | 177  |
| POST   | /procedures/:procedureId/entered-in-error                     | enteredInError         | Staff | encounter.write                |     | ProcedureInErrorDto               |     | 184  |
| GET    | /clinic/procedure-supplies/options                            | supplyOptions          | Staff | encounter.read                 |     |                                   |     | 194  |
| PUT    | /clinic/procedure-definitions/:definitionId/supplies          | setSupplyTemplate      | Staff | clinic.configure               |     | ProcedureSupplyTemplateDto        |     | 204  |
| GET    | /encounters/:encounterId/procedure-supplies                   | suppliesForEncounter   | Staff | encounter.read                 |     |                                   |     | 211  |
| POST   | /procedures/:procedureId/supplies                             | recordSupplies         | Staff | encounter.write                | Y   | RecordProcedureSuppliesDto        |     | 218  |
| POST   | /procedures/:procedureId/supplies/returns                     | returnSupplies         | Staff | encounter.write                | Y   | ReturnProcedureSuppliesDto        |     | 228  |

### libs/clinic/src/lib/referrals/referral.controller.ts

| Method | Path                               | Handler         | Auth  | Perm               | Fac | DTO                        | Thr | Line |
| ------ | ---------------------------------- | --------------- | ----- | ------------------ | --- | -------------------------- | --- | ---- |
| GET    | /encounters/:encounterId/referrals | forEncounter    | Staff | encounter.read     |     |                            |     | 21   |
| POST   | /encounters/:encounterId/referrals | create          | Staff | encounter.write    |     | CreateReferralDto          |     | 28   |
| GET    | /referrals                         | list            | Staff | encounter.read     |     | q:ReferralQueryDto         |     | 35   |
| GET    | /referrals/settings                | settings        | Staff | encounter.read     |     |                            |     | 43   |
| PUT    | /referrals/settings                | updateSettings  | Staff | clinic.configure   |     | ReferralSettingsDto        |     | 50   |
| GET    | /referrals/:referralId             | get             | Staff | encounter.read     |     |                            |     | 57   |
| GET    | /referrals/:referralId/letter.pdf  | letter          | Staff | encounter.read     |     |                            |     | 64   |
| POST   | /referrals/:referralId/answer      | answer          | Staff | encounter.read     |     | AnswerReferralDto          |     | 72   |
| POST   | /referrals/:referralId/appointment | linkAppointment | Staff | appointment.manage |     | LinkReferralAppointmentDto |     | 80   |
| POST   | /referrals/:referralId/complete    | complete        | Staff | encounter.write    |     | CompleteReferralDto        |     | 88   |
| POST   | /referrals/:referralId/cancel      | cancel          | Staff | encounter.read     |     | CancelReferralDto          |     | 96   |

### libs/clinic/src/lib/signatures/practitioner-signature.controller.ts

| Method | Path                                    | Handler        | Auth  | Perm             | Fac | DTO                                   | Thr | Line |
| ------ | --------------------------------------- | -------------- | ----- | ---------------- | --- | ------------------------------------- | --- | ---- |
| GET    | /clinic/practitioner-signature/settings | settings       | Staff | encounter.read   |     |                                       |     | 13   |
| PUT    | /clinic/practitioner-signature/settings | updateSettings | Staff | clinic.configure |     | UpdatePractitionerSignatureSettingDto |     | 20   |
| GET    | /me/practitioner-signature              | mine           | Staff | encounter.read   |     |                                       |     | 27   |
| PUT    | /me/practitioner-signature              | draw           | Staff | encounter.read   |     | DrawPractitionerSignatureDto          |     | 34   |
| POST   | /me/practitioner-signature/withdraw     | withdraw       | Staff | encounter.read   |     |                                       |     | 41   |

### libs/crm/src/lib/crm-series.controller.ts

| Method | Path                         | Handler | Auth  | Perm                 | Fac | DTO              | Thr | Line |
| ------ | ---------------------------- | ------- | ----- | -------------------- | --- | ---------------- | --- | ---- |
| GET    | /outreach/series             | list    | Staff | crm.read             |     |                  |     | 34   |
| GET    | /outreach/series/:id         | get     | Staff | crm.read             |     |                  |     | 41   |
| POST   | /outreach/series             | create  | Staff | crm.campaign.manage  |     | SeriesDto        |     | 48   |
| PUT    | /outreach/series/:id         | update  | Staff | crm.campaign.manage  |     | SeriesUpdateDto  |     | 55   |
| POST   | /outreach/series/:id/submit  | submit  | Staff | crm.campaign.manage  |     | SeriesVersionDto |     | 62   |
| POST   | /outreach/series/:id/reopen  | reopen  | Staff | crm.campaign.manage  |     | SeriesVersionDto |     | 69   |
| POST   | /outreach/series/:id/approve | approve | Staff | crm.campaign.approve |     | SeriesVersionDto |     | 76   |
| POST   | /outreach/series/:id/pause   | pause   | Staff | crm.campaign.manage  |     | SeriesVersionDto |     | 83   |
| POST   | /outreach/series/:id/resume  | resume  | Staff | crm.campaign.manage  |     | SeriesVersionDto |     | 90   |
| POST   | /outreach/series/:id/end     | end     | Staff | crm.campaign.manage  |     | SeriesCloseDto   |     | 97   |
| POST   | /outreach/series/:id/cancel  | cancel  | Staff | crm.campaign.manage  |     | SeriesCloseDto   |     | 104  |

### libs/crm/src/lib/crm.controller.ts

| Method | Path                              | Handler        | Auth   | Perm                 | Fac | DTO               | Thr                                    | Line |
| ------ | --------------------------------- | -------------- | ------ | -------------------- | --- | ----------------- | -------------------------------------- | ---- |
| GET    | /outreach/settings                | getSettings    | Staff  | crm.read             |     |                   |                                        | 62   |
| PUT    | /outreach/settings                | updateSettings | Staff  | crm.campaign.approve |     | SettingsDto       |                                        | 69   |
| GET    | /outreach/segments                | listSegments   | Staff  | crm.read             |     |                   |                                        | 76   |
| POST   | /outreach/segments                | createSegment  | Staff  | crm.segment.manage   |     | SegmentDto        |                                        | 83   |
| PUT    | /outreach/segments/:id            | updateSegment  | Staff  | crm.segment.manage   |     | SegmentUpdateDto  |                                        | 90   |
| POST   | /outreach/segments/:id/archive    | archiveSegment | Staff  | crm.segment.manage   |     | VersionDto        |                                        | 97   |
| GET    | /outreach/segments/:id/preview    | previewSegment | Staff  | crm.read             |     |                   |                                        | 104  |
| GET    | /outreach/campaigns               | listCampaigns  | Staff  | crm.read             |     |                   |                                        | 111  |
| GET    | /outreach/campaigns/:id           | getCampaign    | Staff  | crm.read             |     |                   |                                        | 118  |
| GET    | /outreach/campaigns/:id/reach     | campaignReach  | Staff  | crm.read             |     |                   |                                        | 125  |
| POST   | /outreach/campaigns               | createCampaign | Staff  | crm.campaign.manage  |     | CampaignDto       |                                        | 132  |
| PUT    | /outreach/campaigns/:id           | updateCampaign | Staff  | crm.campaign.manage  |     | CampaignUpdateDto |                                        | 139  |
| POST   | /outreach/campaigns/:id/test-send | testSend       | Staff  | crm.campaign.manage  |     |                   | { default: { limit: 6, ttl: 60_000 } } | 146  |
| POST   | /outreach/campaigns/:id/submit    | submit         | Staff  | crm.campaign.manage  |     | VersionDto        |                                        | 156  |
| POST   | /outreach/campaigns/:id/reopen    | reopen         | Staff  | crm.campaign.manage  |     | VersionDto        |                                        | 163  |
| POST   | /outreach/campaigns/:id/approve   | approve        | Staff  | crm.campaign.approve |     | VersionDto        |                                        | 170  |
| POST   | /outreach/campaigns/:id/cancel    | cancel         | Staff  | crm.campaign.manage  |     | CancelDto         |                                        | 177  |
| POST   | /outreach/opt-out                 | optOut         | PUBLIC | -                    |     | OptOutDto         |                                        | 184  |

### libs/dental/src/lib/dental.controllers.ts

| Method | Path                                                  | Handler               | Auth  | Perm                         | Fac | DTO                      | Thr | Line |
| ------ | ----------------------------------------------------- | --------------------- | ----- | ---------------------------- | --- | ------------------------ | --- | ---- |
| GET    | /dental/visits                                        | visits                | Staff | dental.record.read           | Y   | q:VisitsQueryDto         |     | 52   |
| GET    | /dental/patients/:patientId                           | record                | Staff | dental.record.read           |     |                          |     | 60   |
| GET    | /dental/patients/:patientId/teeth/:tooth              | toothHistory          | Staff | dental.record.read           |     |                          |     | 67   |
| POST   | /dental/patients/:patientId/examinations              | examine               | Staff | dental.chart.write           | Y   | RecordExaminationDto     |     | 75   |
| POST   | /dental/examinations/:examinationId/entered-in-error  | examinationError      | Staff | dental.record.write          |     | EnteredInErrorDto        |     | 83   |
| POST   | /dental/patients/:patientId/perio-charts              | recordPerio           | Staff | dental.chart.write           | Y   | RecordPerioChartDto      |     | 90   |
| GET    | /dental/perio-charts/:chartId                         | perioChart            | Staff | dental.record.read           |     |                          |     | 98   |
| POST   | /dental/perio-charts/:chartId/entered-in-error        | perioError            | Staff | dental.record.write          |     | EnteredInErrorDto        |     | 105  |
| POST   | /dental/patients/:patientId/procedures                | performProcedure      | Staff | dental.procedure.record      | Y   | RecordProcedureDto       |     | 112  |
| POST   | /dental/procedures/:procedureId/entered-in-error      | procedureError        | Staff | dental.record.write          |     | EnteredInErrorDto        |     | 120  |
| POST   | /dental/patients/:patientId/images                    | addImage              | Staff | dental.imaging.upload        | Y   | AddImageDto              |     | 127  |
| GET    | /dental/images/:imageId/link                          | imageLink             | Staff | dental.imaging.read          |     |                          |     | 135  |
| POST   | /dental/images/:imageId/release                       | releaseImage          | Staff | dental.imaging.release       |     |                          |     | 142  |
| POST   | /dental/images/:imageId/withdraw                      | withdrawImage         | Staff | dental.imaging.release       |     | WithdrawImageDto         |     | 149  |
| POST   | /dental/images/:imageId/entered-in-error              | imageError            | Staff | dental.record.write          |     | EnteredInErrorDto        |     | 157  |
| POST   | /dental/treatment-plans                               | create                | Staff | dental.treatment-plan.manage | Y   | CreatePlanDto            |     | 174  |
| GET    | /dental/treatment-plans/:planId                       | get                   | Staff | dental.record.read           |     |                          |     | 182  |
| GET    | /dental/treatment-plans/:planId/estimate              | estimate              | Staff | dental.record.read           |     |                          |     | 188  |
| GET    | /dental/treatment-plans/:planId/estimate.pdf          | estimatePdf           | Staff | dental.record.read           |     |                          |     | 197  |
| POST   | /dental/treatment-plans/:planId/written-estimates     | recordWrittenEstimate | Staff | dental.treatment-plan.manage |     | WrittenEstimateDto       |     | 205  |
| POST   | /dental/treatment-plans/:planId/items                 | addItem               | Staff | dental.treatment-plan.manage |     | AddPlanItemDto           |     | 212  |
| POST   | /dental/treatment-plans/:planId/decision              | decide                | Staff | dental.treatment-plan.manage |     | DecidePlanDto            |     | 218  |
| POST   | /dental/treatment-plans/:planId/items/:itemId/cancel  | cancelItem            | Staff | dental.treatment-plan.manage |     | CancelPlanItemDto        |     | 226  |
| POST   | /dental/treatment-plans/:planId/discontinue           | discontinue           | Staff | dental.treatment-plan.manage |     | DiscontinuePlanDto       |     | 238  |
| GET    | /dental/settings                                      | settings              | Staff | dental.record.read           |     |                          |     | 255  |
| GET    | /dental/settings/portal                               | portalSetting         | Staff | dental.record.read           |     |                          |     | 266  |
| PUT    | /dental/settings/portal                               | setPortalSetting      | Staff | dental.settings.manage       |     | PortalSettingDto         |     | 273  |
| PUT    | /dental/facilities/:facilityId/notation               | setNotation           | Staff | dental.settings.manage       |     | NotationDto              |     | 280  |
| POST   | /dental/procedure-types                               | createProcedureType   | Staff | dental.settings.manage       |     | CreateProcedureTypeDto   |     | 286  |
| PATCH  | /dental/procedure-types/:procedureTypeId              | updateProcedureType   | Staff | dental.settings.manage       |     | UpdateProcedureTypeDto   |     | 293  |
| PUT    | /dental/procedure-types/:procedureTypeId/alternatives | setAlternatives       | Staff | dental.settings.manage       |     | ProcedureAlternativesDto |     | 299  |
| GET    | /dental/supplies/options                              | options               | Staff | dental.record.read           |     |                          |     | 313  |
| PUT    | /dental/procedure-types/:procedureTypeId/supplies     | setTemplate           | Staff | dental.settings.manage       |     | SupplyTemplateDto        |     | 322  |
| PUT    | /dental/facilities/:facilityId/supply-location        | setLocation           | Staff | dental.settings.manage       |     | SupplyLocationDto        |     | 329  |
| POST   | /dental/procedures/:procedureId/supplies              | record                | Staff | dental.procedure.record      | Y   | RecordSuppliesDto        |     | 336  |
| POST   | /dental/procedures/:procedureId/supplies/returns      | returnUnused          | Staff | dental.procedure.record      | Y   | ReturnSuppliesDto        |     | 346  |

### libs/documents/src/lib/document-integrity.controller.ts

| Method | Path                                            | Handler  | Auth  | Perm                      | Fac | DTO                         | Thr | Line |
| ------ | ----------------------------------------------- | -------- | ----- | ------------------------- | --- | --------------------------- | --- | ---- |
| GET    | /document-integrity/runs                        | list     | Staff | document.integrity.manage |     |                             |     | 14   |
| POST   | /document-integrity/runs                        | request  | Staff | document.integrity.manage |     | IntegrityRunDto             |     | 21   |
| GET    | /document-integrity/runs/:runId                 | get      | Staff | document.integrity.manage |     |                             |     | 29   |
| POST   | /document-integrity/runs/:runId/cancel          | cancel   | Staff | document.integrity.manage |     |                             |     | 35   |
| GET    | /document-integrity/findings                    | findings | Staff | document.integrity.manage |     | q:IntegrityFindingsQueryDto |     | 43   |
| POST   | /document-integrity/findings/:findingId/resolve | resolve  | Staff | document.integrity.manage |     | ResolveIntegrityFindingDto  |     | 50   |

### libs/documents/src/lib/document-retention.controller.ts

| Method | Path                              | Handler  | Auth  | Perm                      | Fac | DTO                       | Thr | Line |
| ------ | --------------------------------- | -------- | ----- | ------------------------- | --- | ------------------------- | --- | ---- |
| GET    | /document-retention               | overview | Staff | document.retention.manage |     |                           |     | 15   |
| PUT    | /document-retention               | set      | Staff | document.retention.manage |     | RetentionPolicyDto        |     | 22   |
| POST   | /document-retention/:category/end | end      | Staff | document.retention.manage |     |                           |     | 29   |
| GET    | /document-retention/review        | review   | Staff | document.retention.manage |     | q:RetentionReviewQueryDto |     | 37   |

### libs/documents/src/lib/documents.controller.ts

| Method | Path                                | Handler     | Auth  | Perm             | Fac | DTO                | Thr | Line |
| ------ | ----------------------------------- | ----------- | ----- | ---------------- | --- | ------------------ | --- | ---- |
| POST   | /documents                          | create      | Staff | document.upload  |     | CreateDocumentDto  |     | 13   |
| POST   | /documents/:documentId/complete     | complete    | Staff | document.upload  |     |                    |     | 21   |
| GET    | /documents                          | list        | Staff | document.read    |     | q:ListDocumentsDto |     | 28   |
| GET    | /documents/:documentId              | get         | Staff | document.read    |     |                    |     | 34   |
| GET    | /documents/:documentId/signatures   | signatures  | Staff | document.read    |     |                    |     | 40   |
| GET    | /documents/:documentId/download-url | downloadUrl | Staff | document.read    |     |                    |     | 47   |
| POST   | /documents/:documentId/archive      | archive     | Staff | document.archive |     | ArchiveDocumentDto |     | 54   |

### libs/interoperability/src/lib/doh/doh.controller.ts

| Method | Path                                        | Handler            | Auth  | Perm                | Fac | DTO               | Thr | Line |
| ------ | ------------------------------------------- | ------------------ | ----- | ------------------- | --- | ----------------- | --- | ---- |
| GET    | /doh/integration                            | integration        | Staff | doh.report.manage   |     |                   |     | 19   |
| GET    | /doh/rules                                  | rules              | Staff | doh.report.manage   |     |                   |     | 26   |
| POST   | /doh/rules                                  | createRule         | Staff | doh.settings.manage |     | CreateRuleDto     |     | 33   |
| POST   | /doh/rules/:ruleId/deactivate               | deactivateRule     | Staff | doh.settings.manage |     |                   |     | 40   |
| POST   | /doh/rescans                                | requestRescan      | Staff | doh.settings.manage |     | RescanDto         |     | 47   |
| GET    | /doh/rescans                                | listRescans        | Staff | doh.settings.manage |     |                   |     | 57   |
| GET    | /doh/rescans/:rescanId                      | getRescan          | Staff | doh.settings.manage |     |                   |     | 64   |
| GET    | /doh/facilities/:facilityId/facility-code   | facilityCode       | Staff | doh.settings.manage |     |                   |     | 70   |
| PUT    | /doh/facilities/:facilityId/facility-code   | recordFacilityCode | Staff | doh.settings.manage |     | FacilityCodeDto   |     | 78   |
| GET    | /doh/case-reports                           | list               | Staff | doh.report.manage   |     | q:ListCasesDto    |     | 85   |
| GET    | /doh/case-reports/:caseReportId             | get                | Staff | doh.report.manage   |     |                   |     | 92   |
| POST   | /doh/case-reports/:caseReportId/reported    | recordExternal     | Staff | doh.report.manage   |     | RecordExternalDto |     | 99   |
| POST   | /doh/case-reports/:caseReportId/dismiss     | dismiss            | Staff | doh.report.manage   |     | DismissDto        |     | 107  |
| POST   | /doh/case-reports/:caseReportId/submissions | submit             | Staff | doh.report.manage   |     | SubmitCaseDto     |     | 115  |

### libs/interoperability/src/lib/exchange/exchange-review.controller.ts

| Method | Path                                        | Handler | Auth  | Perm                        | Fac | DTO                | Thr | Line |
| ------ | ------------------------------------------- | ------- | ----- | --------------------------- | --- | ------------------ | --- | ---- |
| GET    | /integrations/exchanges                     | list    | Staff | integration.exchange.manage |     | q:ListExchangesDto |     | 14   |
| POST   | /integrations/exchanges/:exchangeId/requeue | requeue | Staff | integration.exchange.manage |     |                    |     | 20   |
| POST   | /integrations/exchanges/:exchangeId/resolve | resolve | Staff | integration.exchange.manage |     | ResolveExchangeDto |     | 27   |

### libs/interoperability/src/lib/exchange/payload-keys.controller.ts

| Method | Path                       | Handler | Auth  | Perm           | Fac | DTO | Thr | Line |
| ------ | -------------------------- | ------- | ----- | -------------- | --- | --- | --- | ---- |
| GET    | /integrations/payload-keys | list    | Staff | platform-admin |     |     |     | 12   |

### libs/interoperability/src/lib/fhir-import/fhir-import.controller.ts

| Method | Path                                            | Handler      | Auth  | Perm                       | Fac | DTO                   | Thr | Line |
| ------ | ----------------------------------------------- | ------------ | ----- | -------------------------- | --- | --------------------- | --- | ---- |
| GET    | /fhir-imports                                   | list         | Staff | interop.fhir.import.review |     | q:ListImportsDto      |     | 18   |
| GET    | /fhir-imports/:importId                         | get          | Staff | interop.fhir.import.review |     |                       |     | 24   |
| GET    | /fhir-imports/:importId/candidates              | candidates   | Staff | interop.fhir.import.review |     |                       |     | 30   |
| POST   | /fhir-imports/:importId/match                   | match        | Staff | interop.fhir.import.review |     | MatchPatientDto       |     | 36   |
| POST   | /fhir-imports/:importId/register-patient        | register     | Staff | interop.fhir.import.review |     | RegisterFromImportDto |     | 43   |
| POST   | /fhir-imports/:importId/entries/:entryId/accept | accept       | Staff | interop.fhir.import.review |     |                       |     | 50   |
| POST   | /fhir-imports/:importId/entries/:entryId/reject | reject       | Staff | interop.fhir.import.review |     | RejectEntryDto        |     | 57   |
| POST   | /fhir-imports/:importId/reject                  | rejectImport | Staff | interop.fhir.import.review |     | RejectImportDto       |     | 69   |

### libs/interoperability/src/lib/reference-lab/reference-lab.controller.ts

| Method | Path                                                                    | Handler     | Auth  | Perm                 | Fac | DTO              | Thr | Line |
| ------ | ----------------------------------------------------------------------- | ----------- | ----- | -------------------- | --- | ---------------- | --- | ---- |
| GET    | /integrations/reference-laboratories                                    | integration | Staff | lab.order.read       |     |                  |     | 17   |
| GET    | /integrations/reference-laboratories/dispatches/:dispatchId/submissions | status      | Staff | lab.order.read       |     |                  |     | 24   |
| POST   | /integrations/reference-laboratories/dispatches/:dispatchId/submissions | submit      | Staff | lab.specimen.receive |     | SubmitSendOutDto |     | 31   |

### libs/inventory/src/lib/compliance/inventory-compliance.controller.ts

| Method | Path                                          | Handler                     | Auth  | Perm                                                         | Fac | DTO                          | Thr | Line |
| ------ | --------------------------------------------- | --------------------------- | ----- | ------------------------------------------------------------ | --- | ---------------------------- | --- | ---- |
| GET    | /inventory/withholding-codes                  | withholdingCodes            | Staff | inventory.read                                               |     |                              |     | 17   |
| POST   | /inventory/withholding-codes                  | createWithholdingCode       | Staff | inventory.procurement.approve                                |     | CreateWithholdingCodeDto     |     | 23   |
| POST   | /inventory/withholding-codes/:id/deactivate   | deactivateWithholdingCode   | Staff | inventory.procurement.approve                                |     |                              |     | 30   |
| GET    | /inventory/procurement-methods                | procurementMethods          | Staff | inventory.read                                               |     |                              |     | 37   |
| POST   | /inventory/procurement-methods                | createProcurementMethod     | Staff | inventory.procurement.approve                                |     | CreateProcurementMethodDto   |     | 43   |
| POST   | /inventory/procurement-methods/:id/deactivate | deactivateProcurementMethod | Staff | inventory.procurement.approve                                |     |                              |     | 50   |
| GET    | /inventory/controlled-register/setting        | registerSetting             | Staff | inventory.controlled-register.read                           | Y   |                              |     | 57   |
| PUT    | /inventory/controlled-register/setting        | setRegisterSetting          | Staff | inventory.controlled-register.read, inventory.catalog.manage | Y   | ControlledRegisterSettingDto |     | 64   |

### libs/inventory/src/lib/inventory.controllers.ts

| Method | Path                                                         | Handler         | Auth  | Perm                     | Fac | DTO                 | Thr | Line |
| ------ | ------------------------------------------------------------ | --------------- | ----- | ------------------------ | --- | ------------------- | --- | ---- |
| GET    | /inventory/items                                             | items           | Staff | inventory.read           |     |                     |     | 27   |
| POST   | /inventory/items                                             | createItem      | Staff | inventory.catalog.manage |     | CreateItemDto       |     | 33   |
| PATCH  | /inventory/items/:itemId                                     | updateItem      | Staff | inventory.catalog.manage |     | UpdateItemDto       |     | 40   |
| GET    | /inventory/suppliers                                         | suppliers       | Staff | inventory.read           |     |                     |     | 46   |
| POST   | /inventory/suppliers                                         | createSupplier  | Staff | inventory.catalog.manage |     | CreateSupplierDto   |     | 52   |
| GET    | /inventory/locations                                         | locations       | Staff | inventory.read           |     |                     |     | 58   |
| POST   | /inventory/locations                                         | createLocation  | Staff | inventory.catalog.manage |     | CreateLocationDto   |     | 65   |
| PUT    | /inventory/locations/:locationId/items/:itemId/reorder-level | setReorderLevel | Staff | inventory.catalog.manage | Y   | ReorderLevelDto     |     | 71   |
| GET    | /inventory/stock                                             | list            | Staff | inventory.read           | Y   | q:StockQueryDto     |     | 91   |
| GET    | /inventory/movements                                         | movements       | Staff | inventory.read           | Y   | q:MovementsQueryDto |     | 98   |
| POST   | /inventory/receipts                                          | receive         | Staff | inventory.move           | Y   | ReceiveDto          |     | 104  |
| POST   | /inventory/issues                                            | issue           | Staff | inventory.move           | Y   | IssueDto            |     | 111  |
| POST   | /inventory/transfers                                         | transfer        | Staff | inventory.move           | Y   | TransferDto         |     | 118  |
| POST   | /inventory/adjustments                                       | adjust          | Staff | inventory.adjust         | Y   | AdjustDto           |     | 124  |
| POST   | /inventory/write-offs                                        | writeOff        | Staff | inventory.adjust         | Y   | WriteOffDto         |     | 132  |

### libs/inventory/src/lib/procurement/procurement.controller.ts

| Method | Path                                                  | Handler     | Auth  | Perm                                         | Fac | DTO                         | Thr | Line |
| ------ | ----------------------------------------------------- | ----------- | ----- | -------------------------------------------- | --- | --------------------------- | --- | ---- |
| GET    | /inventory/reorder-suggestions                        | suggestions | Staff | inventory.read                               | Y   | q:ReorderSuggestionQueryDto |     | 31   |
| GET    | /inventory/purchase-orders                            | list        | Staff | inventory.read                               | Y   | q:PurchaseOrderQueryDto     |     | 38   |
| GET    | /inventory/purchase-orders/:purchaseOrderId           | get         | Staff | inventory.read                               | Y   |                             |     | 44   |
| POST   | /inventory/purchase-orders                            | create      | Staff | inventory.procurement.manage                 | Y   | CreatePurchaseOrderDto      |     | 50   |
| PUT    | /inventory/purchase-orders/:purchaseOrderId           | update      | Staff | inventory.procurement.manage                 | Y   | UpdatePurchaseOrderDto      |     | 57   |
| POST   | /inventory/purchase-orders/:purchaseOrderId/submit    | submit      | Staff | inventory.procurement.manage                 | Y   | PurchaseOrderVersionDto     |     | 64   |
| POST   | /inventory/purchase-orders/:purchaseOrderId/approve   | approve     | Staff | inventory.procurement.approve                | Y   | PurchaseOrderVersionDto     |     | 71   |
| POST   | /inventory/purchase-orders/:purchaseOrderId/receipts  | receive     | Staff | inventory.procurement.manage, inventory.move | Y   | ReceivePurchaseOrderDto     |     | 79   |
| POST   | /inventory/purchase-orders/:purchaseOrderId/cancel    | cancel      | Staff | inventory.procurement.manage                 | Y   | EndPurchaseOrderDto         |     | 87   |
| POST   | /inventory/purchase-orders/:purchaseOrderId/close     | close       | Staff | inventory.procurement.manage                 | Y   | EndPurchaseOrderDto         |     | 95   |
| GET    | /inventory/purchase-orders/:purchaseOrderId/invoicing | invoicing   | Staff | inventory.read                               | Y   |                             |     | 111  |
| POST   | /inventory/purchase-orders/:purchaseOrderId/invoices  | record      | Staff | inventory.procurement.manage                 | Y   | RecordSupplierInvoiceDto    |     | 118  |
| GET    | /inventory/supplier-invoices                          | list        | Staff | inventory.read                               | Y   | q:SupplierInvoiceQueryDto   |     | 125  |
| GET    | /inventory/supplier-invoices/:invoiceId               | get         | Staff | inventory.read                               | Y   |                             |     | 131  |
| POST   | /inventory/supplier-invoices/:invoiceId/approve       | approve     | Staff | inventory.procurement.approve                | Y   | ApproveSupplierInvoiceDto   |     | 137  |
| POST   | /inventory/supplier-invoices/:invoiceId/payment       | pay         | Staff | inventory.procurement.manage                 | Y   | PaySupplierInvoiceDto       |     | 145  |
| POST   | /inventory/supplier-invoices/:invoiceId/void          | void        | Staff | inventory.procurement.manage                 | Y   | VoidSupplierInvoiceDto      |     | 153  |
| GET    | /inventory/valuation                                  | valuation   | Staff | inventory.valuation.read                     | Y   | q:ValuationQueryDto         |     | 169  |
| GET    | /inventory/valuation/usage                            | usage       | Staff | inventory.valuation.read                     | Y   | q:UsageQueryDto             |     | 176  |

### libs/laboratory/src/lib/instruments/lab-instrument-interface.controller.ts

| Method | Path                                             | Handler     | Auth  | Perm                          | Fac | DTO                        | Thr | Line |
| ------ | ------------------------------------------------ | ----------- | ----- | ----------------------------- | --- | -------------------------- | --- | ---- |
| GET    | /laboratory/instruments/:id/interface            | settings    | Staff | lab.qc.read                   |     |                            |     | 22   |
| PUT    | /laboratory/instruments/:id/interface            | configure   | Staff | lab.qc.manage                 |     | InstrumentInterfaceDto     |     | 29   |
| PUT    | /laboratory/instruments/:id/interface/test-codes | setTestCode | Staff | lab.qc.manage                 |     | InstrumentTestCodeDto      |     | 36   |
| POST   | /laboratory/instruments/:id/messages             | receive     | Staff | lab.instrument.message.submit |     | InstrumentMessageDto       |     | 43   |
| GET    | /laboratory/instrument-results                   | list        | Staff | lab.result.read               | Y   | q:InstrumentResultQueryDto |     | 51   |
| POST   | /laboratory/instrument-results/:id/accept        | accept      | Staff | lab.result.enter              | Y   |                            |     | 59   |
| POST   | /laboratory/instrument-results/:id/dismiss       | dismiss     | Staff | lab.result.enter              | Y   | DismissInstrumentResultDto |     | 68   |

### libs/laboratory/src/lib/laboratory.controllers.ts

| Method | Path                                           | Handler               | Auth  | Perm                            | Fac | DTO                    | Thr | Line |
| ------ | ---------------------------------------------- | --------------------- | ----- | ------------------------------- | --- | ---------------------- | --- | ---- |
| GET    | /laboratory/departments                        | departments           | Staff | lab.order.read                  |     | q:CatalogQueryDto      |     | 46   |
| POST   | /laboratory/departments                        | createDepartment      | Staff | lab.catalog.manage              |     | CreateDepartmentDto    |     | 52   |
| PATCH  | /laboratory/departments/:id                    | updateDepartment      | Staff | lab.catalog.manage              |     | UpdateCatalogEntryDto  |     | 58   |
| GET    | /laboratory/specimen-types                     | specimenTypes         | Staff | lab.order.read                  |     | q:CatalogQueryDto      |     | 64   |
| POST   | /laboratory/specimen-types                     | createSpecimenType    | Staff | lab.catalog.manage              |     | CreateSpecimenTypeDto  |     | 70   |
| PATCH  | /laboratory/specimen-types/:id                 | updateSpecimenType    | Staff | lab.catalog.manage              |     | UpdateCatalogEntryDto  |     | 76   |
| GET    | /laboratory/tests                              | tests                 | Staff | lab.order.read                  |     | q:CatalogQueryDto      |     | 82   |
| GET    | /laboratory/tests/:id                          | test                  | Staff | lab.order.read                  |     |                        |     | 89   |
| POST   | /laboratory/tests                              | createTest            | Staff | lab.catalog.manage              |     | CreateTestDto          |     | 96   |
| PATCH  | /laboratory/tests/:id                          | updateTest            | Staff | lab.catalog.manage              |     | UpdateTestDto          |     | 102  |
| POST   | /laboratory/tests/:id/reference-ranges         | addRange              | Staff | lab.catalog.manage              |     | AddReferenceRangeDto   |     | 108  |
| GET    | /laboratory/panels                             | panels                | Staff | lab.order.read                  |     | q:CatalogQueryDto      |     | 115  |
| POST   | /laboratory/panels                             | createPanel           | Staff | lab.catalog.manage              |     | CreatePanelDto         |     | 121  |
| PATCH  | /laboratory/panels/:id                         | updatePanel           | Staff | lab.catalog.manage              |     | UpdateCatalogEntryDto  |     | 127  |
| GET    | /laboratory/policy                             | policy                | Staff | lab.order.read                  | Y   |                        |     | 133  |
| PUT    | /laboratory/policy                             | setPolicy             | Staff | lab.catalog.manage              | Y   | FacilityPolicyDto      |     | 141  |
| POST   | /laboratory/orders                             | create                | Staff | lab.order.create                | Y   | CreateOrderDto         |     | 160  |
| GET    | /laboratory/orders                             | list                  | Staff | lab.order.read                  |     | q:ListOrdersDto        |     | 169  |
| GET    | /laboratory/orders/:id                         | get                   | Staff | lab.order.read                  |     |                        |     | 175  |
| POST   | /laboratory/orders/:id/cancel                  | cancel                | Staff | lab.order.cancel                |     | CancelDto              |     | 181  |
| POST   | /laboratory/orders/:id/items/:itemId/cancel    | cancelItem            | Staff | lab.order.cancel                |     | CancelDto              |     | 188  |
| POST   | /laboratory/orders/:id/specimens               | collect               | Staff | lab.specimen.collect            | Y   | CollectSpecimenDto     |     | 195  |
| GET    | /laboratory/specimens/by-accession/:accession  | byAccession           | Staff | lab.order.read                  | Y   |                        |     | 204  |
| GET    | /laboratory/specimens/:id/label.pdf            | label                 | Staff | lab.specimen.collect            | Y   | q:LabelQueryDto        |     | 212  |
| GET    | /laboratory/specimens/:id/events               | specimenEvents        | Staff | lab.order.read                  |     |                        |     | 221  |
| POST   | /laboratory/specimens/:id/receive              | receive               | Staff | lab.specimen.receive            | Y   |                        |     | 227  |
| POST   | /laboratory/specimens/:id/reject               | reject                | Staff | lab.specimen.reject             |     | RejectSpecimenDto      |     | 235  |
| GET    | /laboratory/worklist                           | worklist              | Staff | lab.order.read                  | Y   | q:WorklistDto          |     | 242  |
| GET    | /laboratory/dashboard                          | dashboard             | Staff | lab.dashboard.read              | Y   |                        |     | 250  |
| POST   | /laboratory/order-items/:itemId/results        | enter                 | Staff | lab.result.enter                | Y   | EnterResultDto         |     | 269  |
| GET    | /laboratory/order-items/:itemId/results        | history               | Staff | lab.result.read                 |     |                        |     | 277  |
| POST   | /laboratory/results/:id/verify                 | verify                | Staff | lab.result.verify               | Y   |                        |     | 284  |
| POST   | /laboratory/results/:id/approve                | approve               | Staff | lab.result.approve              | Y   |                        |     | 292  |
| POST   | /laboratory/results/:id/release                | release               | Staff | lab.result.release              | Y   |                        |     | 300  |
| POST   | /laboratory/orders/:id/release                 | releaseOrder          | Staff | lab.result.release              | Y   |                        |     | 308  |
| POST   | /laboratory/results/:id/cancel                 | cancel                | Staff | lab.result.enter                | Y   | CancelDto              |     | 326  |
| GET    | /laboratory/results/:id/attachments            | listAttachments       | Staff | lab.result.read                 |     |                        |     | 334  |
| POST   | /laboratory/results/:id/attachments            | startAttachment       | Staff | lab.result.enter                | Y   | StartAttachmentDto     |     | 341  |
| POST   | /laboratory/attachments/:id/complete           | completeAttachment    | Staff | lab.result.enter                | Y   |                        |     | 349  |
| POST   | /laboratory/attachments/:id/remove             | removeAttachment      | Staff | lab.result.enter                | Y   | RemoveAttachmentDto    |     | 358  |
| GET    | /laboratory/attachments/:id/download-url       | attachmentDownloadUrl | Staff | lab.result.read                 |     |                        |     | 367  |
| GET    | /laboratory/orders/:id/report.pdf              | report                | Staff | lab.order.read, lab.result.read |     |                        |     | 374  |
| GET    | /laboratory/patients/:patientId/report-archive | archivedReports       | Staff | lab.order.read, lab.result.read |     |                        |     | 382  |
| GET    | /laboratory/report-archive/:id/report.pdf      | archivedReport        | Staff | lab.order.read, lab.result.read |     |                        |     | 389  |
| GET    | /laboratory/patients/:patientId/results        | patientResults        | Staff | lab.result.read                 |     |                        |     | 397  |
| GET    | /laboratory/patients/:patientId/trends         | trend                 | Staff | lab.result.read                 |     | q:TrendQueryDto        |     | 404  |
| GET    | /laboratory/critical-results                   | criticals             | Staff | lab.result.read                 | Y   | q:CriticalQueryDto     |     | 411  |
| POST   | /laboratory/critical-results/:id/communicate   | communicate           | Staff | lab.critical.manage             |     | CommunicateCriticalDto |     | 418  |
| POST   | /laboratory/critical-results/:id/acknowledge   | acknowledge           | Staff | lab.result.read                 |     |                        |     | 426  |

### libs/laboratory/src/lib/quality/lab-quality-management.controller.ts

| Method | Path                                       | Handler                | Auth  | Perm          | Fac | DTO                      | Thr | Line |
| ------ | ------------------------------------------ | ---------------------- | ----- | ------------- | --- | ------------------------ | --- | ---- |
| GET    | /laboratory/licence                        | licence                | Staff | lab.qc.read   | Y   |                          |     | 47   |
| POST   | /laboratory/licence                        | recordLicence          | Staff | lab.qc.manage | Y   | RecordLicenceDto         |     | 55   |
| GET    | /laboratory/quality/summary                | summary                | Staff | lab.qc.read   | Y   |                          |     | 63   |
| GET    | /laboratory/storage-units                  | storageUnits           | Staff | lab.qc.read   | Y   | q:StorageUnitQueryDto    |     | 73   |
| POST   | /laboratory/storage-units                  | createStorageUnit      | Staff | lab.qc.manage | Y   | CreateStorageUnitDto     |     | 81   |
| PATCH  | /laboratory/storage-units/:id              | updateStorageUnit      | Staff | lab.qc.manage |     | UpdateStorageUnitDto     |     | 88   |
| GET    | /laboratory/storage-units/:id/readings     | readings               | Staff | lab.qc.read   |     | q:ReadingQueryDto        |     | 95   |
| POST   | /laboratory/storage-units/:id/readings     | recordReading          | Staff | lab.qc.enter  | Y   | RecordReadingDto         |     | 101  |
| GET    | /laboratory/nonconformances                | nonconformanceList     | Staff | lab.qc.read   | Y   | q:NonconformanceQueryDto |     | 111  |
| GET    | /laboratory/nonconformances/:id            | nonconformance         | Staff | lab.qc.read   |     |                          |     | 118  |
| POST   | /laboratory/nonconformances                | reportNonconformance   | Staff | lab.qc.enter  | Y   | CreateNonconformanceDto  |     | 124  |
| POST   | /laboratory/nonconformances/:id/entries    | addNonconformanceEntry | Staff | lab.qc.enter  |     | NonconformanceEntryDto   |     | 132  |
| POST   | /laboratory/nonconformances/:id/reclassify | reclassify             | Staff | lab.qc.manage |     | ReclassifyDto            |     | 139  |
| POST   | /laboratory/nonconformances/:id/close      | closeNonconformance    | Staff | lab.qc.manage |     | CloseNonconformanceDto   |     | 146  |
| GET    | /laboratory/eqa/schemes                    | eqaSchemes             | Staff | lab.qc.read   |     |                          |     | 156  |
| POST   | /laboratory/eqa/schemes                    | createEqaScheme        | Staff | lab.qc.manage |     | CreateEqaSchemeDto       |     | 162  |
| GET    | /laboratory/eqa/surveys                    | eqaSurveys             | Staff | lab.qc.read   | Y   |                          |     | 168  |
| POST   | /laboratory/eqa/surveys                    | createEqaSurvey        | Staff | lab.qc.enter  | Y   | CreateEqaSurveyDto       |     | 176  |
| POST   | /laboratory/eqa/surveys/:id/results        | reportEqaResult        | Staff | lab.qc.enter  | Y   | ReportEqaResultDto       |     | 183  |
| POST   | /laboratory/eqa/results/:id/evaluation     | evaluateEqaResult      | Staff | lab.qc.enter  | Y   | EqaEvaluationDto         |     | 190  |
| GET    | /laboratory/competency                     | competencyOverview     | Staff | lab.qc.read   | Y   |                          |     | 201  |
| GET    | /laboratory/competency/users/:userId       | competencyHistory      | Staff | lab.qc.read   |     |                          |     | 209  |
| POST   | /laboratory/competency                     | recordCompetency       | Staff | lab.qc.manage | Y   | RecordCompetencyDto      |     | 215  |

### libs/laboratory/src/lib/quality/lab-quality.controller.ts

| Method | Path                                              | Handler               | Auth  | Perm          | Fac | DTO                    | Thr | Line |
| ------ | ------------------------------------------------- | --------------------- | ----- | ------------- | --- | ---------------------- | --- | ---- |
| GET    | /laboratory/instruments                           | instruments           | Staff | lab.qc.read   | Y   | q:InstrumentQueryDto   |     | 40   |
| POST   | /laboratory/instruments                           | createInstrument      | Staff | lab.qc.manage | Y   | CreateInstrumentDto    |     | 48   |
| PATCH  | /laboratory/instruments/:id                       | updateInstrument      | Staff | lab.qc.manage |     | UpdateInstrumentDto    |     | 55   |
| GET    | /laboratory/instruments/:id/log                   | instrumentLog         | Staff | lab.qc.read   |     |                        |     | 61   |
| POST   | /laboratory/instruments/:id/log                   | logInstrument         | Staff | lab.qc.enter  | Y   | InstrumentEventDto     |     | 68   |
| GET    | /laboratory/reagents                              | reagentsInUse         | Staff | lab.qc.read   | Y   | q:ReagentQueryDto      |     | 78   |
| GET    | /laboratory/reagents/available                    | reagentsAvailable     | Staff | lab.qc.read   | Y   |                        |     | 86   |
| GET    | /laboratory/instruments/:id/reagents              | reagentHistory        | Staff | lab.qc.read   |     |                        |     | 94   |
| POST   | /laboratory/instruments/:id/reagents              | loadReagent           | Staff | lab.qc.enter  | Y   | LoadReagentDto         |     | 101  |
| POST   | /laboratory/reagents/:loadId/unload               | unloadReagent         | Staff | lab.qc.enter  | Y   | UnloadReagentDto       |     | 109  |
| GET    | /laboratory/reagents/usage                        | reagentUsage          | Staff | lab.qc.read   | Y   | q:ReagentUsageQueryDto |     | 119  |
| GET    | /laboratory/reagents/yields                       | reagentYields         | Staff | lab.qc.read   |     |                        |     | 127  |
| PUT    | /laboratory/reagents/yields/:itemId               | setReagentYield       | Staff | lab.qc.manage |     | SetReagentYieldDto     |     | 134  |
| GET    | /laboratory/reagents/tests-per-run                | reagentTestsPerRun    | Staff | lab.qc.read   |     |                        |     | 141  |
| PUT    | /laboratory/reagents/yields/:itemId/tests/:testId | setReagentTestsPerRun | Staff | lab.qc.manage |     | SetTestsPerRunDto      |     | 148  |
| GET    | /laboratory/reagents/:loadId/uses                 | reagentUses           | Staff | lab.qc.read   |     |                        |     | 160  |
| POST   | /laboratory/reagents/:loadId/uses                 | recordReagentUse      | Staff | lab.qc.enter  | Y   | RecordReagentUseDto    |     | 167  |
| GET    | /laboratory/qc/materials                          | materials             | Staff | lab.qc.read   |     |                        |     | 177  |
| POST   | /laboratory/qc/materials                          | createMaterial        | Staff | lab.qc.manage |     | CreateQcMaterialDto    |     | 184  |
| POST   | /laboratory/qc/materials/:id/lots                 | createLot             | Staff | lab.qc.manage |     | CreateQcLotDto         |     | 190  |
| POST   | /laboratory/qc/lots/:id/retire                    | retireLot             | Staff | lab.qc.manage |     |                        |     | 196  |
| POST   | /laboratory/qc/lots/:id/targets                   | addTarget             | Staff | lab.qc.manage |     | AddQcTargetDto         |     | 203  |
| GET    | /laboratory/qc/status                             | status                | Staff | lab.qc.read   | Y   |                        |     | 212  |
| GET    | /laboratory/qc/runs                               | runs                  | Staff | lab.qc.read   |     | q:QcRunQueryDto        |     | 220  |
| POST   | /laboratory/qc/runs                               | recordRun             | Staff | lab.qc.enter  | Y   | RecordQcRunDto         |     | 227  |
| POST   | /laboratory/qc/runs/:id/actions                   | addAction             | Staff | lab.qc.enter  |     | QcActionDto            |     | 235  |

### libs/laboratory/src/lib/send-outs/send-out.controller.ts

| Method | Path                                             | Handler         | Auth  | Perm                 | Fac | DTO                   | Thr | Line |
| ------ | ------------------------------------------------ | --------------- | ----- | -------------------- | --- | --------------------- | --- | ---- |
| GET    | /laboratory/reference-labs                       | list            | Staff | lab.order.read       |     | q:CatalogQueryDto     |     | 30   |
| POST   | /laboratory/reference-labs                       | create          | Staff | lab.catalog.manage   |     | CreateReferenceLabDto |     | 37   |
| PATCH  | /laboratory/reference-labs/:id                   | update          | Staff | lab.catalog.manage   |     | UpdateReferenceLabDto |     | 43   |
| GET    | /laboratory/referrals                            | referrals       | Staff | lab.order.read       | Y   |                       |     | 49   |
| PUT    | /laboratory/referrals/:testId                    | setReferral     | Staff | lab.catalog.manage   | Y   | SetReferralDto        |     | 57   |
| DELETE | /laboratory/referrals/:testId                    | removeReferral  | Staff | lab.catalog.manage   | Y   | RemoveReferralDto     |     | 65   |
| GET    | /laboratory/send-outs                            | list            | Staff | lab.order.read       | Y   | q:ListSendOutsDto     |     | 84   |
| POST   | /laboratory/send-outs                            | prepare         | Staff | lab.specimen.receive | Y   | PrepareSendOutDto     |     | 92   |
| POST   | /laboratory/send-outs/:id/results-received       | resultsReceived | Staff | lab.specimen.receive | Y   | ResultsReceivedDto    |     | 100  |
| POST   | /laboratory/send-outs/:id/reject                 | reject          | Staff | lab.specimen.reject  | Y   | ReferenceRejectDto    |     | 109  |
| POST   | /laboratory/send-outs/:id/cancel                 | cancel          | Staff | lab.specimen.receive | Y   | CancelSendOutDto      |     | 118  |
| POST   | /laboratory/send-out-dispatches                  | dispatch        | Staff | lab.specimen.receive | Y   | DispatchDto           |     | 127  |
| GET    | /laboratory/send-out-dispatches                  | dispatches      | Staff | lab.order.read       | Y   |                       |     | 136  |
| GET    | /laboratory/send-out-dispatches/:id              | dispatchDetail  | Staff | lab.order.read       |     |                       |     | 143  |
| GET    | /laboratory/send-out-dispatches/:id/manifest.pdf | manifest        | Staff | lab.specimen.receive | Y   |                       |     | 149  |

### libs/notification/src/lib/notification.controller.ts

| Method | Path                                   | Handler     | Auth  | Perm              | Fac | DTO                    | Thr | Line |
| ------ | -------------------------------------- | ----------- | ----- | ----------------- | --- | ---------------------- | --- | ---- |
| POST   | /notifications                         | send        | Staff | notification.send |     | SendNotificationDto    |     | 14   |
| GET    | /notifications                         | history     | Staff | notification.read |     | q:ListNotificationsDto |     | 24   |
| GET    | /me/notifications                      | inbox       | Staff | -                 |     |                        |     | 31   |
| GET    | /me/notifications/unread-count         | unreadCount | Staff | -                 |     |                        |     | 37   |
| POST   | /me/notifications/:notificationId/read | markRead    | Staff | -                 |     |                        |     | 43   |

### libs/organization/src/lib/compliance/compliance.controller.ts

| Method | Path                | Handler  | Auth  | Perm                     | Fac | DTO                       | Thr | Line |
| ------ | ------------------- | -------- | ----- | ------------------------ | --- | ------------------------- | --- | ---- |
| GET    | /compliance/reviews | overview | Staff | compliance.review.manage |     |                           |     | 13   |
| POST   | /compliance/reviews | record   | Staff | compliance.review.manage |     | RecordComplianceReviewDto |     | 20   |

### libs/organization/src/lib/organization.controller.ts

| Method | Path                                | Handler          | Auth  | Perm                | Fac | DTO                   | Thr | Line |
| ------ | ----------------------------------- | ---------------- | ----- | ------------------- | --- | --------------------- | --- | ---- |
| POST   | /organizations                      | create           | Staff | platform-admin      |     | CreateOrganizationDto |     | 12   |
| GET    | /organization                       | current          | Staff | organization.read   |     |                       |     | 19   |
| PATCH  | /organization                       | updateCurrent    | Staff | organization.manage |     | UpdateOrganizationDto |     | 26   |
| GET    | /facilities                         | listFacilities   | Staff | organization.read   |     |                       |     | 33   |
| POST   | /facilities                         | createFacility   | Staff | organization.manage |     | CreateFacilityDto     |     | 39   |
| GET    | /facilities/:facilityId             | getFacility      | Staff | organization.read   |     |                       |     | 45   |
| PATCH  | /facilities/:facilityId             | updateFacility   | Staff | organization.manage |     | UpdateFacilityDto     |     | 51   |
| GET    | /facilities/:facilityId/departments | listDepartments  | Staff | organization.read   |     |                       |     | 57   |
| POST   | /facilities/:facilityId/departments | createDepartment | Staff | organization.manage |     | CreateDepartmentDto   |     | 63   |

### libs/organization/src/lib/privacy/privacy.controller.ts

| Method | Path                                                 | Handler          | Auth  | Perm                    | Fac | DTO                           | Thr | Line |
| ------ | ---------------------------------------------------- | ---------------- | ----- | ----------------------- | --- | ----------------------------- | --- | ---- |
| GET    | /privacy/setting                                     | setting          | Staff | privacy.incident.manage |     |                               |     | 23   |
| PUT    | /privacy/setting                                     | setSetting       | Staff | privacy.incident.manage |     | PrivacySettingDto             |     | 30   |
| GET    | /privacy/incidents                                   | list             | Staff | privacy.incident.manage |     | q:PrivacyIncidentQueryDto     |     | 37   |
| POST   | /privacy/incidents                                   | record           | Staff | privacy.incident.manage |     | RecordPrivacyIncidentDto      |     | 44   |
| GET    | /privacy/incidents/:incidentId                       | get              | Staff | privacy.incident.manage |     |                               |     | 51   |
| POST   | /privacy/incidents/:incidentId/entries               | addEntry         | Staff | privacy.incident.manage |     | AddIncidentEntryDto           |     | 58   |
| POST   | /privacy/incidents/:incidentId/assess                | assess           | Staff | privacy.incident.manage |     | AssessIncidentDto             |     | 65   |
| POST   | /privacy/incidents/:incidentId/npc-notification      | npcNotified      | Staff | privacy.incident.manage |     | RecordNpcNotificationDto      |     | 73   |
| POST   | /privacy/incidents/:incidentId/subjects-notification | subjectsNotified | Staff | privacy.incident.manage |     | RecordSubjectsNotificationDto |     | 81   |
| POST   | /privacy/incidents/:incidentId/close                 | close            | Staff | privacy.incident.manage |     | CloseIncidentDto              |     | 89   |

### libs/organization/src/lib/tour/tour.controller.ts

| Method | Path                       | Handler | Auth  | Perm                | Fac | DTO                 | Thr | Line |
| ------ | -------------------------- | ------- | ----- | ------------------- | --- | ------------------- | --- | ---- |
| GET    | /organization/tour-setting | get     | Staff | -                   |     |                     |     | 14   |
| PUT    | /organization/tour-setting | set     | Staff | organization.manage |     | StaffTourSettingDto |     | 20   |

### libs/patient/src/lib/consents/consent-text.controller.ts

| Method | Path           | Handler | Auth  | Perm                   | Fac | DTO                   | Thr | Line |
| ------ | -------------- | ------- | ----- | ---------------------- | --- | --------------------- | --- | ---- |
| GET    | /consent-texts | list    | Staff | consent.wording.manage |     |                       |     | 13   |
| POST   | /consent-texts | publish | Staff | consent.wording.manage |     | PublishConsentTextDto |     | 20   |

### libs/patient/src/lib/consents/portal-consents.controller.ts

| Method | Path                                   | Handler  | Auth   | Perm | Fac | DTO            | Thr | Line |
| ------ | -------------------------------------- | -------- | ------ | ---- | --- | -------------- | --- | ---- |
| GET    | /portal/consents                       | list     | Portal | -    |     |                |     | 26   |
| GET    | /portal/consents/:consentType/wording  | wording  | Portal | -    |     |                |     | 32   |
| POST   | /portal/consents/:consentType/give     | give     | Portal | -    |     | GiveConsentDto |     | 38   |
| POST   | /portal/consents/:consentType/withdraw | withdraw | Portal | -    |     |                |     | 45   |

### libs/patient/src/lib/merge/patient-merge.controller.ts

| Method | Path                               | Handler | Auth  | Perm                        | Fac | DTO                    | Thr | Line |
| ------ | ---------------------------------- | ------- | ----- | --------------------------- | --- | ---------------------- | --- | ---- |
| GET    | /patients/:patientId/merge-preview | preview | Staff | patient.read, patient.merge |     | q:MergePreviewQueryDto |     | 13   |
| POST   | /patients/:patientId/merge         | merge   | Staff | patient.read, patient.merge |     | MergePatientDto        |     | 20   |
| POST   | /patients/:patientId/unmerge       | unmerge | Staff | patient.read, patient.merge |     | UnmergePatientDto      |     | 28   |
| GET    | /patients/:patientId/merges        | history | Staff | patient.read                |     |                        |     | 36   |

### libs/patient/src/lib/messaging/patient-message.controller.ts

| Method | Path                                                           | Handler        | Auth   | Perm                                | Fac | DTO                 | Thr                                     | Line |
| ------ | -------------------------------------------------------------- | -------------- | ------ | ----------------------------------- | --- | ------------------- | --------------------------------------- | ---- |
| GET    | /portal/message-threads                                        | list           | Portal | -                                   |     |                     |                                         | 30   |
| GET    | /portal/message-threads/unread-count                           | unread         | Portal | -                                   |     |                     |                                         | 36   |
| POST   | /portal/message-threads/uploads                                | startUpload    | Portal | -                                   |     | PatientUploadDto    | { default: { limit: 20, ttl: 60_000 } } | 42   |
| POST   | /portal/message-threads/uploads/:documentId/complete           | completeUpload | Portal | -                                   |     |                     |                                         | 49   |
| GET    | /portal/message-threads/:threadId/attachments/:documentId/link | attachmentLink | Portal | -                                   |     |                     |                                         | 56   |
| GET    | /portal/message-threads/:threadId                              | open           | Portal | -                                   |     |                     |                                         | 66   |
| POST   | /portal/message-threads                                        | start          | Portal | -                                   |     | StartThreadDto      | { default: { limit: 20, ttl: 60_000 } } | 72   |
| POST   | /portal/message-threads/:threadId/messages                     | reply          | Portal | -                                   |     | ReplyDto            | { default: { limit: 20, ttl: 60_000 } } | 79   |
| GET    | /patient-messages                                              | list           | Staff  | patient.message.read                |     | q:ThreadQueryDto    |                                         | 95   |
| GET    | /patient-messages/awaiting-count                               | awaiting       | Staff  | patient.message.read                |     |                     |                                         | 107  |
| GET    | /patient-messages/overdue-count                                | overdue        | Staff  | patient.message.read                |     |                     |                                         | 113  |
| GET    | /patient-messages/settings                                     | settings       | Staff  | patient.message.read                |     | q:SettingsQueryDto  |                                         | 120  |
| PUT    | /patient-messages/settings                                     | upsertSetting  | Staff  | clinic.configure                    |     | UpsertSettingDto    |                                         | 127  |
| GET    | /patient-messages/:threadId/attachments/:documentId/link       | attachmentLink | Staff  | patient.message.read, document.read |     |                     |                                         | 134  |
| GET    | /patient-messages/:threadId                                    | get            | Staff  | patient.message.read                |     |                     |                                         | 141  |
| POST   | /patient-messages                                              | start          | Staff  | patient.message.manage              |     | StaffStartThreadDto |                                         | 148  |
| POST   | /patient-messages/:threadId/messages                           | reply          | Staff  | patient.message.manage              |     | ReplyDto            |                                         | 155  |
| POST   | /patient-messages/:threadId/notes                              | note           | Staff  | patient.message.manage              |     | NoteDto             |                                         | 163  |
| POST   | /patient-messages/:threadId/assignment                         | assign         | Staff  | patient.message.manage              |     | AssignThreadDto     |                                         | 171  |
| POST   | /patient-messages/:threadId/close                              | close          | Staff  | patient.message.manage              |     |                     |                                         | 178  |
| POST   | /patient-messages/:threadId/reopen                             | reopen         | Staff  | patient.message.manage              |     |                     |                                         | 185  |

### libs/patient/src/lib/patient.controller.ts

| Method | Path                                           | Handler            | Auth  | Perm                   | Fac | DTO                         | Thr | Line |
| ------ | ---------------------------------------------- | ------------------ | ----- | ---------------------- | --- | --------------------------- | --- | ---- |
| GET    | /patients                                      | find               | Staff | patient.search         |     | q:PatientSearchDto          |     | 34   |
| POST   | /patients/duplicate-check                      | duplicateCheck     | Staff | patient.register       |     | DuplicateCheckDto           |     | 41   |
| POST   | /patients                                      | register           | Staff | patient.register       | Y   | RegisterPatientDto          |     | 49   |
| GET    | /patients/:patientId                           | get                | Staff | patient.read           |     |                             |     | 59   |
| PATCH  | /patients/:patientId                           | updateDemographics | Staff | patient.update         |     | UpdateDemographicsDto       |     | 65   |
| POST   | /patients/:patientId/status                    | changeStatus       | Staff | patient.update         |     | ChangeStatusDto             |     | 72   |
| POST   | /patients/:patientId/contacts                  | addContact         | Staff | patient.update         |     | AddContactDto               |     | 80   |
| POST   | /patients/:patientId/addresses                 | addAddress         | Staff | patient.update         |     | AddAddressDto               |     | 86   |
| POST   | /patients/:patientId/identifiers               | addIdentifier      | Staff | patient.update         |     | AddIdentifierDto            |     | 92   |
| POST   | /patients/:patientId/relationships             | addRelationship    | Staff | patient.update         |     | AddRelationshipDto          |     | 98   |
| DELETE | /patients/:patientId/:collection/:recordId     | retire             | Staff | patient.update         |     | RetireDto                   |     | 104  |
| GET    | /patients/:patientId/consents                  | consents           | Staff | patient.read           |     |                             |     | 120  |
| POST   | /patients/:patientId/consents                  | recordConsent      | Staff | patient.consent.manage |     | RecordConsentDto            |     | 127  |
| PUT    | /patients/:patientId/communication-preferences | setPreferences     | Staff | patient.consent.manage |     | CommunicationPreferencesDto |     | 133  |

### libs/patient/src/lib/portal/portal.controller.ts

| Method | Path                                                  | Handler              | Auth   | Perm                  | Fac | DTO                           | Thr                 | Line |
| ------ | ----------------------------------------------------- | -------------------- | ------ | --------------------- | --- | ----------------------------- | ------------------- | ---- |
| POST   | /portal/auth/password-reset/request                   | requestPasswordReset | PUBLIC | -                     |     | PortalPasswordResetRequestDto | CREDENTIAL_THROTTLE | 34   |
| POST   | /portal/auth/password-reset/confirm                   | confirmPasswordReset | PUBLIC | -                     |     | PortalPasswordResetConfirmDto | CREDENTIAL_THROTTLE | 45   |
| POST   | /portal/auth/activation-card                          | activationCard       | PUBLIC | -                     |     | PortalCardDto                 | CREDENTIAL_THROTTLE | 55   |
| POST   | /portal/auth/activate                                 | activate             | PUBLIC | -                     |     | PortalActivateDto             | CREDENTIAL_THROTTLE | 65   |
| POST   | /portal/auth/login                                    | login                | PUBLIC | -                     |     | PortalLoginDto                | CREDENTIAL_THROTTLE | 75   |
| POST   | /portal/auth/refresh                                  | refresh              | PUBLIC | -                     |     | PortalRefreshDto              | CREDENTIAL_THROTTLE | 84   |
| POST   | /portal/auth/logout                                   | logout               | Portal | -                     |     |                               |                     | 93   |
| POST   | /portal/realtime-tickets                              | realtimeTicket       | Portal | -                     |     |                               |                     | 103  |
| GET    | /portal/me                                            | me                   | Portal | -                     |     |                               |                     | 113  |
| GET    | /patients/:patientId/portal-account                   | status               | Staff  | patient.read          |     |                               |                     | 135  |
| POST   | /patients/:patientId/portal-account/invitations       | invite               | Staff  | patient.portal.manage |     |                               |                     | 141  |
| POST   | /patients/:patientId/portal-account/mfa-reset         | resetMfa             | Staff  | patient.portal.manage |     | DisablePortalAccountDto       |                     | 148  |
| POST   | /patients/:patientId/portal-account/mfa-exemption     | exemptMfa            | Staff  | patient.portal.manage |     | DisablePortalAccountDto       |                     | 156  |
| POST   | /patients/:patientId/portal-account/mfa-exemption/end | endMfaExemption      | Staff  | patient.portal.manage |     | DisablePortalAccountDto       |                     | 164  |
| POST   | /patients/:patientId/portal-account/disable           | disable              | Staff  | patient.portal.manage |     | DisablePortalAccountDto       |                     | 176  |

### libs/patient/src/lib/preferences/portal-preferences.controller.ts

| Method | Path                              | Handler | Auth   | Perm | Fac | DTO                  | Thr | Line |
| ------ | --------------------------------- | ------- | ------ | ---- | --- | -------------------- | --- | ---- |
| GET    | /portal/communication-preferences | get     | Portal | -    |     |                      |     | 20   |
| PUT    | /portal/communication-preferences | set     | Portal | -    |     | PortalPreferencesDto |     | 26   |

### libs/patient/src/lib/proxy/proxy.controller.ts

| Method | Path                                                | Handler    | Auth   | Perm                        | Fac | DTO            | Thr | Line |
| ------ | --------------------------------------------------- | ---------- | ------ | --------------------------- | --- | -------------- | --- | ---- |
| GET    | /portal/proxy/dependents                            | dependents | Portal | -                           |     |                |     | 21   |
| GET    | /portal/proxy/guardians                             | guardians  | Portal | -                           |     |                |     | 27   |
| POST   | /portal/proxy/grants/:grantId/end                   | end        | Portal | -                           |     |                |     | 33   |
| GET    | /patients/:patientId/portal-proxies                 | overview   | Staff  | patient.read                |     |                |     | 48   |
| POST   | /patients/:patientId/portal-proxies                 | grant      | Staff  | patient.portal.proxy.manage |     | GrantProxyDto  |     | 55   |
| POST   | /patients/:patientId/portal-proxies/:grantId/revoke | revoke     | Staff  | patient.portal.proxy.manage |     | RevokeProxyDto |     | 62   |

### libs/patient/src/lib/qr/qr.controller.ts

| Method | Path                                       | Handler    | Auth  | Perm                           | Fac | DTO                 | Thr | Line |
| ------ | ------------------------------------------ | ---------- | ----- | ------------------------------ | --- | ------------------- | --- | ---- |
| GET    | /patient-qr/setting                        | setting    | Staff | patient.search                 |     |                     |     | 14   |
| PUT    | /patient-qr/setting                        | setSetting | Staff | patient.qr.manage              |     | PatientQrSettingDto |     | 21   |
| POST   | /patient-qr/scan                           | scan       | Staff | patient.search                 |     | ScanPatientQrDto    |     | 28   |
| GET    | /patient-qr/patients/:patientId            | state      | Staff | patient.qr.issue, patient.read |     |                     |     | 36   |
| POST   | /patient-qr/patients/:patientId            | issue      | Staff | patient.qr.issue, patient.read |     |                     |     | 43   |
| POST   | /patient-qr/patients/:patientId/revoke     | revoke     | Staff | patient.qr.issue, patient.read |     | RevokePatientQrDto  |     | 50   |
| POST   | /patient-qr/patients/:patientId/regenerate | regenerate | Staff | patient.qr.issue, patient.read |     | RevokePatientQrDto  |     | 58   |
| GET    | /patient-qr/patients/:patientId/card.pdf   | card       | Staff | patient.qr.issue, patient.read |     |                     |     | 66   |

### libs/patient/src/lib/records-requests/records-request.controller.ts

| Method | Path                                 | Handler    | Auth  | Perm                                                | Fac | DTO                      | Thr | Line |
| ------ | ------------------------------------ | ---------- | ----- | --------------------------------------------------- | --- | ------------------------ | --- | ---- |
| GET    | /records-requests                    | list       | Staff | patient.records-request.manage                      |     | q:RecordsRequestQueryDto |     | 14   |
| GET    | /records-requests/setting            | setting    | Staff | patient.records-request.manage                      |     |                          |     | 21   |
| PUT    | /records-requests/setting            | setSetting | Staff | patient.records-request.manage, organization.manage |     | RecordsRequestSettingDto |     | 28   |
| GET    | /records-requests/:requestId         | get        | Staff | patient.records-request.manage                      |     |                          |     | 35   |
| POST   | /records-requests/:requestId/review  | review     | Staff | patient.records-request.manage                      |     | StartReviewDto           |     | 42   |
| POST   | /records-requests/:requestId/fulfil  | fulfil     | Staff | patient.records-request.manage                      |     | FulfilRecordsRequestDto  |     | 49   |
| POST   | /records-requests/:requestId/decline | decline    | Staff | patient.records-request.manage                      |     | DeclineRecordsRequestDto |     | 57   |

### libs/patient/src/lib/security/portal-mfa-policy.controller.ts

| Method | Path                         | Handler | Auth  | Perm            | Fac | DTO                 | Thr | Line |
| ------ | ---------------------------- | ------- | ----- | --------------- | --- | ------------------- | --- | ---- |
| GET    | /security/patient-mfa-policy | view    | Staff | user.read       |     |                     |     | 14   |
| PUT    | /security/patient-mfa-policy | update  | Staff | user.mfa.manage |     | PatientMfaPolicyDto |     | 21   |

### libs/patient/src/lib/security/portal-security.controller.ts

| Method | Path                                   | Handler            | Auth   | Perm | Fac | DTO                   | Thr                 | Line |
| ------ | -------------------------------------- | ------------------ | ------ | ---- | --- | --------------------- | ------------------- | ---- |
| GET    | /portal/email                          | emailStatus        | Portal | -    |     |                       |                     | 92   |
| POST   | /portal/email/verification             | sendVerification   | Portal | -    |     |                       | CREDENTIAL_THROTTLE | 98   |
| POST   | /portal/email/verification/confirm     | confirmEmail       | Portal | -    |     | ConfirmEmailDto       | CREDENTIAL_THROTTLE | 106  |
| POST   | /portal/email/change                   | changeEmail        | Portal | -    |     | ChangeEmailDto        | CREDENTIAL_THROTTLE | 114  |
| GET    | /portal/mfa                            | mfaStatus          | Portal | -    |     |                       |                     | 124  |
| POST   | /portal/mfa/setup                      | beginMfa           | Portal | -    |     | MfaBeginDto           | CREDENTIAL_THROTTLE | 130  |
| POST   | /portal/mfa/enable                     | enableMfa          | Portal | -    |     | MfaEnableDto          | CREDENTIAL_THROTTLE | 138  |
| POST   | /portal/mfa/disable                    | disableMfa         | Portal | -    |     | MfaPasswordAndCodeDto | CREDENTIAL_THROTTLE | 146  |
| POST   | /portal/mfa/recovery-codes             | renewRecoveryCodes | Portal | -    |     | MfaPasswordAndCodeDto | CREDENTIAL_THROTTLE | 154  |
| GET    | /portal/mfa/passkeys                   | passkeyList        | Portal | -    |     |                       |                     | 162  |
| POST   | /portal/mfa/passkeys/options           | passkeyOptions     | Portal | -    |     | MfaPasswordAndCodeDto | CREDENTIAL_THROTTLE | 168  |
| POST   | /portal/mfa/passkeys                   | addPasskey         | Portal | -    |     | PasskeyAddDto         | CREDENTIAL_THROTTLE | 178  |
| POST   | /portal/mfa/passkeys/:passkeyId/remove | removePasskey      | Portal | -    |     |                       |                     | 186  |
| GET    | /portal/mfa/devices                    | devicesList        | Portal | -    |     |                       |                     | 193  |
| POST   | /portal/mfa/devices/:deviceId/forget   | forgetDevice       | Portal | -    |     |                       |                     | 199  |
| POST   | /portal/mfa/devices/forget-all         | forgetAllDevices   | Portal | -    |     |                       |                     | 206  |
| POST   | /portal/auth/mfa/passkey/options       | passkeyOptions     | PUBLIC | -    |     | PasskeyChallengeDto   | CREDENTIAL_THROTTLE | 223  |
| POST   | /portal/auth/mfa/verify                | verify             | PUBLIC | -    |     | MfaVerifyDto          | CREDENTIAL_THROTTLE | 233  |

### libs/philhealth/src/lib/eligibility.controller.ts

| Method | Path                            | Handler | Auth  | Perm                          | Fac | DTO                   | Thr | Line |
| ------ | ------------------------------- | ------- | ----- | ----------------------------- | --- | --------------------- | --- | ---- |
| GET    | /philhealth/eligibility         | list    | Staff | philhealth.eligibility.manage |     | q:ListEligibilityDto  |     | 14   |
| POST   | /philhealth/eligibility/records | record  | Staff | philhealth.eligibility.manage |     | RecordEligibilityDto  |     | 20   |
| POST   | /philhealth/eligibility/checks  | request | Staff | philhealth.eligibility.manage |     | RequestEligibilityDto |     | 26   |

### libs/philhealth/src/lib/philhealth.controller.ts

| Method | Path                                               | Handler             | Auth  | Perm                       | Fac | DTO              | Thr | Line |
| ------ | -------------------------------------------------- | ------------------- | ----- | -------------------------- | --- | ---------------- | --- | ---- |
| GET    | /philhealth/integration                            | integration         | Staff | philhealth.claim.submit    |     |                  |     | 17   |
| GET    | /philhealth/facilities/:facilityId/accreditation   | accreditation       | Staff | philhealth.settings.manage |     |                  |     | 24   |
| PUT    | /philhealth/facilities/:facilityId/accreditation   | recordAccreditation | Staff | philhealth.settings.manage |     | AccreditationDto |     | 33   |
| GET    | /philhealth/claims/invoices/:invoiceId             | preview             | Staff | philhealth.claim.submit    |     |                  |     | 40   |
| POST   | /philhealth/claims/invoices/:invoiceId/submissions | submit              | Staff | philhealth.claim.submit    |     | SubmitClaimDto   |     | 47   |

### libs/philhealth/src/lib/yakap.controller.ts

| Method | Path                                                   | Handler             | Auth  | Perm                          | Fac | DTO                         | Thr | Line |
| ------ | ------------------------------------------------------ | ------------------- | ----- | ----------------------------- | --- | --------------------------- | --- | ---- |
| GET    | /philhealth/facilities/:facilityId/yakap-participation | participation       | Staff | philhealth.settings.manage    |     |                             |     | 18   |
| PUT    | /philhealth/facilities/:facilityId/yakap-participation | recordParticipation | Staff | philhealth.settings.manage    |     | YakapParticipationDto       |     | 27   |
| GET    | /philhealth/yakap/registrations                        | registrations       | Staff | philhealth.eligibility.manage |     | q:ListYakapRegistrationsDto |     | 34   |
| POST   | /philhealth/yakap/registrations                        | recordRegistration  | Staff | philhealth.eligibility.manage |     | RecordYakapRegistrationDto  |     | 41   |
| GET    | /philhealth/yakap/patients/:patientId/consultations    | consultations       | Staff | philhealth.claim.submit       |     |                             |     | 48   |
| GET    | /philhealth/yakap/encounters/:encounterId              | preview             | Staff | philhealth.claim.submit       |     |                             |     | 55   |
| POST   | /philhealth/yakap/encounters/:encounterId/submissions  | submit              | Staff | philhealth.claim.submit       |     | SubmitYakapDto              |     | 62   |

### libs/prescription/src/lib/dispensing/dispensing.controller.ts

| Method | Path                                                | Handler  | Auth  | Perm                                  | Fac | DTO                  | Thr | Line |
| ------ | --------------------------------------------------- | -------- | ----- | ------------------------------------- | --- | -------------------- | --- | ---- |
| GET    | /dispensing/stock                                   | stock    | Staff | prescription.dispense, inventory.read | Y   |                      |     | 14   |
| GET    | /dispensing/prescriptions                           | find     | Staff | prescription.dispense                 | Y   |                      |     | 21   |
| GET    | /dispensing/prescriptions/:prescriptionId           | get      | Staff | prescription.dispense                 | Y   |                      |     | 28   |
| POST   | /dispensing/prescriptions/:prescriptionId/dispenses | dispense | Staff | prescription.dispense, inventory.move | Y   | DispenseDto          |     | 35   |
| POST   | /dispensing/dispenses/:dispenseId/reverse           | reverse  | Staff | prescription.dispense, inventory.move | Y   | ReverseDispenseDto   |     | 42   |
| GET    | /dispensing/dispenses                               | recent   | Staff | prescription.dispense                 | Y   | q:RecentDispensesDto |     | 50   |

### libs/prescription/src/lib/prescription.controller.ts

| Method | Path                                   | Handler | Auth  | Perm                | Fac | DTO                      | Thr | Line |
| ------ | -------------------------------------- | ------- | ----- | ------------------- | --- | ------------------------ | --- | ---- |
| POST   | /prescriptions                         | issue   | Staff | prescription.issue  |     | IssuePrescriptionDto     |     | 17   |
| GET    | /prescriptions                         | list    | Staff | prescription.read   |     | q:ListPrescriptionsDto   |     | 25   |
| GET    | /prescriptions/issued                  | issued  | Staff | prescription.read   | Y   | q:IssuedPrescriptionsDto |     | 31   |
| GET    | /prescriptions/:prescriptionId         | get     | Staff | prescription.read   |     |                          |     | 41   |
| POST   | /prescriptions/:prescriptionId/replace | replace | Staff | prescription.issue  |     | ReplacePrescriptionDto   |     | 47   |
| POST   | /prescriptions/:prescriptionId/cancel  | cancel  | Staff | prescription.cancel |     | CancelPrescriptionDto    |     | 54   |

### libs/telemedicine/src/lib/telemedicine.controller.ts

| Method | Path                                                    | Handler      | Auth  | Perm                                  | Fac | DTO                    | Thr | Line |
| ------ | ------------------------------------------------------- | ------------ | ----- | ------------------------------------- | --- | ---------------------- | --- | ---- |
| GET    | /telemedicine/consultations                             | day          | Staff | telemedicine.read                     | Y   | q:DayDto               |     | 20   |
| GET    | /telemedicine/consultations/video-status                | videoStatus  | Staff | telemedicine.read                     | Y   |                        |     | 27   |
| GET    | /telemedicine/consultations/:appointmentId              | get          | Staff | telemedicine.read                     | Y   |                        |     | 34   |
| GET    | /telemedicine/consultations/:appointmentId/messages     | messages     | Staff | telemedicine.read                     | Y   | q:MessagesQueryDto     |     | 41   |
| POST   | /telemedicine/consultations/:appointmentId/messages     | sendMessage  | Staff | telemedicine.conduct                  | Y   | SendMessageDto         |     | 48   |
| POST   | /telemedicine/consultations/:appointmentId/start        | start        | Staff | telemedicine.conduct, encounter.write | Y   |                        |     | 55   |
| POST   | /telemedicine/consultations/:appointmentId/join         | join         | Staff | telemedicine.conduct                  | Y   |                        |     | 63   |
| POST   | /telemedicine/consultations/:appointmentId/end          | end          | Staff | telemedicine.conduct                  | Y   | EndDto                 |     | 70   |
| POST   | /telemedicine/consultations/:appointmentId/escalate     | escalate     | Staff | telemedicine.conduct                  | Y   | EscalateDto            |     | 78   |
| PUT    | /telemedicine/consultations/:appointmentId/instructions | instructions | Staff | telemedicine.conduct                  | Y   | InstructionsDto        |     | 86   |
| GET    | /telemedicine/settings                                  | get          | Staff | clinic.configure                      |     |                        |     | 101  |
| PUT    | /telemedicine/settings                                  | set          | Staff | clinic.configure                      |     | TelemedicineSettingDto |     | 108  |

## D. Mutating routes without a Zod body DTO (judgment)

The scan found 61 POST/PUT/PATCH handlers whose signature has no `@Body()` DTO class. 59 are body-less state transitions (path id only; the global `ZodValidationPipe`, `app.module.ts:~262`, has nothing to validate, the id is a `ParseUUIDPipe` param in the cases sampled). Two accept `@Body() body: unknown` and rely on validation _inside_ the service:

| Route                                                                                                                      | Where validated                                                                                                                   | Judgment                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /fhir/r4/imports` (`apps/api/src/app/fhir/fhir-import.controller.ts:23-30`)                                          | `FhirImportService.receive` (R4 validation, 512 KiB/100 entries per CLAUDE.md; Not verified by reading the service in this audit) | Acceptable by design (FHIR content is not a Zod DTO), but input size is bounded only by the global 1 MB JSON limit (`configure-app.ts:19`) |
| `PUT /portal/teleconsults/:appointmentId/questionnaire` (`apps/api/src/app/portal/portal-teleconsult.controller.ts:33-37`) | `telemedicine.submitQuestionnaire(..., body)` (service-side parse; Not verified)                                                  | Inconsistent with the rest of the API; recommend a DTO at the controller edge (API-012)                                                    |

Routes whose `:id` path param is a plain `string` with no `ParseUUIDPipe` (22 handlers: `libs/crm/src/lib/crm.controller.ts`, `libs/crm/src/lib/crm-series.controller.ts`, `apps/api/src/app/management-dashboard/management-report.controller.ts:50,57`) are listed in finding API-005.

## Findings

Details, evidence and fixes for each ID are in `NESTJS_BACKEND_SECURITY_AUDIT.md` (API-001 to API-018) and `API_SECURITY_TEST_REPORT.md` (API-019 to API-026). Those that come from the route inventory itself:

| ID      | Severity | Title                                                                                               | Evidence                                                                                                                                                                                                                                                           | Status |
| ------- | -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| API-004 | LOW      | 22 handlers take `:id` as an unvalidated string; a non-UUID returns 500 instead of 400              | `libs/crm/src/lib/crm.controller.ts:93-180`, `libs/crm/src/lib/crm-series.controller.ts:44-107`, `apps/api/src/app/management-dashboard/management-report.controller.ts:50,57`; filter has no `22P02` mapping (`libs/core/src/lib/http/exception.filter.ts:57-70`) | Open   |
| API-011 | LOW      | Two mutating routes accept `@Body() unknown`                                                        | `apps/api/src/app/fhir/fhir-import.controller.ts:23-30`, `apps/api/src/app/portal/portal-teleconsult.controller.ts:33-37`                                                                                                                                          | Open   |
| API-012 | INFO     | `GET /health/ready` is public and reports dependency states                                         | `apps/api/src/app/health.controller.ts:48-60`                                                                                                                                                                                                                      | Open   |
| API-015 | LOW      | Public webhook and opt-out routes have no dedicated throttle                                        | `libs/billing/src/lib/billing.controllers.ts:474`, `libs/crm/src/lib/crm.controller.ts:184`                                                                                                                                                                        | Open   |
| API-020 | LOW      | No automated route-matrix test guarding the 17 public and 19 authenticated-only routes listed above | see test report                                                                                                                                                                                                                                                    | Open   |

Inventory-level conclusions (Verified by scan, textual): no controller mixes class-level and method-level `@RequirePermissions`; no staff route outside section B lacks a permission or platform-admin requirement; every `/portal/*` route is either one of the six MyHealth credential routes plus two MFA-login routes in section A, or sits behind `PatientAccessGuard`. The scan does not evaluate runtime metadata, so a dynamic override (for example a custom guard added in a module) would not be seen; no such guard was found in `app.module.ts`.
