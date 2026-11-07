# Phase 2 — Kiosk and Queue Management Backend

Implement the backend foundation for the Healthcare Management Platform's Patient Self-Service Kiosk and Queue Management module.

Technology:

- NestJS
- TypeScript
- PostgreSQL

Follow the architecture established during the approved repository audit.

## Backend Modules

Implement or extend:

- KioskModule
- PatientMatchingModule
- PatientCheckInModule
- QueueModule
- QueueCounterModule
- QueueCallingModule
- QueueDisplayModule
- KioskDeviceModule
- QueueNotificationModule
- QueueAuditModule

## Database Requirements

Implement migrations and entities for:

- kiosk_devices
- kiosk_sessions
- kiosk_registrations
- patient_check_ins
- queue_departments
- queue_counters
- queue_sequences
- queue_tickets
- queue_calls
- queue_status_history
- queue_ticket_transfers
- queue_settings
- queue_counter_assignments
- queue_display_devices
- queue_audit_logs
- queue_outbox_events

Reuse existing patient, appointment, encounter, facility, department, and user tables.

## Business Logic

Implement:

1. Full patient registration submission.
2. Existing patient matching.
3. Appointment eligibility verification.
4. Patient check-in.
5. Atomic queue ticket generation.
6. Concurrent-safe Call Next processing.
7. Queue priority handling.
8. Recall and skip.
9. No-show handling.
10. Queue completion.
11. Department transfer.
12. Manual walk-in registration.
13. Registration verification and approval.

## Technical Requirements

- DTO validation.
- Database transactions.
- Foreign-key constraints.
- Unique constraints.
- Appropriate database indexes.
- Idempotency protection.
- Role-based authorization.
- Facility-level authorization.
- Rate limiting.
- Audit logging.
- Outbox event pattern.
- Consistent error responses.

Use PostgreSQL transactions and row locking to prevent duplicate queue numbers and duplicate ticket assignments.

Do not use SELECT MAX(sequence_number) + 1 for ticket generation.

Do not create duplicate patient records.

## Testing

Implement unit and integration tests for:

- Patient matching.
- Registration.
- Appointment check-in.
- Queue sequencing.
- Concurrent ticket generation.
- Concurrent Call Next operations.
- Status transitions.
- Queue transfers.
- Authorization.

Deliver complete working implementations, not placeholder services or mock business logic.

Run the existing test suite and report any regressions.
