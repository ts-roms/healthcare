# MASTER IMPLEMENTATION PROMPT
# Healthcare Platform — Patient Self-Service Kiosk & Digital Queue Management

Act as a Principal Software Architect, Senior NestJS Engineer, Senior Next.js Engineer, PostgreSQL Database Architect, and Healthcare Systems Security Engineer.

You are working directly inside my existing repository:

https://github.com/ts-roms/healthcare

Your task is to design and implement a production-quality Patient Self-Service Kiosk and Digital Queue Management module integrated into the existing Healthcare Platform.

IMPORTANT: This is an extension of an existing healthcare platform, NOT a new standalone hospital management system.

==================================================
1. EXISTING ARCHITECTURE — MUST BE PRESERVED
==================================================

This repository uses:

- Nx monorepo.
- pnpm workspace.
- NestJS modular-monolith API.
- Next.js staff application.
- Next.js patient portal.
- PostgreSQL.
- Drizzle ORM.
- Forward-only SQL migrations.
- React and TypeScript.
- Tailwind CSS v4.
- shadcn/ui and Radix.
- Custom Healthcare Design System.
- Socket.IO real-time infrastructure.
- Redis and BullMQ infrastructure.
- Transactional domain event outbox.
- Existing audit infrastructure.
- Existing authentication, MFA and RBAC.

Existing architectural libraries include:

- libs/patient
- libs/clinic
- libs/core
- libs/audit
- libs/organization
- libs/auth
- libs/notification
- libs/ui

Follow the repository's CLAUDE.md, Nx dependency boundaries, architecture documentation, existing conventions, and established domain contracts.

Do not introduce Prisma, TypeORM, a second ORM, a second database, or another independent queue engine.

==================================================
2. EXISTING FUNCTIONALITY TO REUSE
==================================================

Inspect and reuse the following existing functionality:

PATIENT:
- Patient Master.
- Patient registration.
- Patient lookup.
- Duplicate patient detection.
- Patient merge.
- Patient identifiers.
- Emergency contacts.
- Address management.
- Consent management.

CLINIC:
- Walk-in check-in.
- Queue management.
- Queue calling.
- Queue movement.
- Appointment scheduling.
- Appointment check-in.
- Appointment cancellation.
- Appointment no-show.
- Triage.
- Encounters.
- Facility and department configuration.

PLATFORM:
- RBAC.
- MFA.
- Facility authorization.
- Audit logs.
- Domain events.
- Transactional outbox.
- Socket.IO gateway.
- Notification infrastructure.
- Healthcare Design System.

Do not duplicate existing business logic or create parallel implementations.

==================================================
3. REQUIRED NEW APPLICATIONS
==================================================

Create a new isolated Next.js application:

apps/kiosk

It will provide:

A. PATIENT SELF-SERVICE KIOSK

Routes:

- /kiosk/[deviceCode]
- /kiosk/[deviceCode]/start
- /kiosk/[deviceCode]/registration
- /kiosk/[deviceCode]/existing-patient
- /kiosk/[deviceCode]/appointment
- /kiosk/[deviceCode]/services
- /kiosk/[deviceCode]/review
- /kiosk/[deviceCode]/ticket

B. PUBLIC QUEUE DISPLAY

Routes:

- /display/[displayCode]

The public display must use a separate restricted authentication context and must never expose patient records or staff-only functionality.

C. KIOSK DEVICE MANAGEMENT

Device configuration and monitoring must be managed through the existing authorized staff application.

==================================================
4. PATIENT KIOSK FUNCTIONAL REQUIREMENTS
==================================================

Support three patient journeys:

A. NEW PATIENT

- Full patient registration.
- Personal information.
- Demographics.
- Contact details.
- Address.
- Emergency contact.
- Hospital-required information.
- Privacy notice.
- Registration validation.
- Duplicate patient detection.
- Registration review.
- Registration confirmation.

B. EXISTING PATIENT

- Identify existing patient.
- Verify identity.
- Match against Patient Master.
- Display masked patient information.
- Confirm identity.
- Initiate walk-in check-in.
- Prevent duplicate active check-ins.

C. APPOINTMENT CHECK-IN

- Identify appointment.
- Verify patient ownership.
- Verify appointment status.
- Verify check-in window.
- Prevent duplicate check-in.
- Associate check-in with the correct appointment.
- Generate the appropriate queue assignment.

All three journeys must integrate with existing domain services.

Do not create duplicate patient or appointment entities.

==================================================
5. RECEPTIONIST QUEUE MANAGEMENT
==================================================

Extend the existing staff application at:

/queue

Implement or improve:

- Live waiting queue.
- Now serving.
- Queue statistics.
- Call next.
- Recall.
- Skip.
- No-show.
- Complete.
- Transfer.
- Requeue.
- Manual walk-in.
- Patient verification.
- Registration review.
- Multiple counters.
- Department filtering.
- Queue history.

Preserve existing queue operations and clinical workflow.

Use the existing authorization and audit systems.

==================================================
6. PUBLIC QUEUE DISPLAY
==================================================

Implement:

- Current queue number.
- Counter assignment.
- Department grouping.
- Recently called tickets.
- Live updates.
- Voice announcements.
- Full-screen TV layout.
- Reconnection.
- Polling fallback.

Never display:

- Patient full names.
- Patient numbers.
- Diagnoses.
- Medical records.
- Contact information.
- Sensitive personal information.

==================================================
7. HARDWARE INTEGRATION
==================================================

Implement support for:

A. Touchscreen kiosk
- Full-screen browser mode.
- Automatic session reset.
- Device authentication.
- Device health monitoring.

B. Thermal printer
- 80mm support.
- Optional 58mm support.
- Local authenticated print agent.
- Print job queue.
- Retry handling.
- Print status.
- Authorized reprinting.

C. Waiting-area TV
- Full-screen display.
- WebSocket updates.
- Voice announcements.
- Automatic reconnect.

Create the local print agent under:

tools/kiosk-print-agent

Do not expose an unrestricted printer service to the network.

==================================================
8. DATABASE REQUIREMENTS
==================================================

Before adding migrations, inspect the existing PostgreSQL schema.

The database source of truth is:

database/migrations/

Use the existing Drizzle definitions and repository migration conventions.

Evaluate whether new persistence is needed for:

- Kiosk devices.
- Kiosk sessions.
- Pending registration submissions.
- Display devices.
- Ticket print history.

Extend existing queue entities when appropriate.

Do not create duplicate patient, appointment, queue, audit, or event tables.

All migrations must:

- Be forward-only.
- Include appropriate indexes.
- Include constraints.
- Preserve tenant and facility isolation.
- Preserve existing records.
- Be reversible operationally through a documented recovery strategy.
- Pass schema consistency tests.

==================================================
9. REAL-TIME IMPLEMENTATION
==================================================

Reuse the existing Socket.IO infrastructure and transactional domain event outbox.

Implement events as appropriate:

- queue.ticket.created
- queue.ticket.called
- queue.ticket.recalled
- queue.ticket.skipped
- queue.ticket.completed
- queue.ticket.transferred
- queue.display.updated
- kiosk.device.status_changed

Do not create a second event publishing system.

Ensure:
- Event authorization.
- Duplicate event handling.
- Reconnection.
- State synchronization.
- Event ordering where required.
- Reliable publication after database commits.

==================================================
10. SECURITY REQUIREMENTS
==================================================

Implement:

- Restricted kiosk device credentials.
- Short-lived kiosk sessions.
- Automatic inactivity timeout.
- Session cleanup.
- No sensitive patient data in browser storage.
- Patient identity verification.
- Duplicate registration protection.
- Rate limiting.
- Strict API validation.
- Facility-level authorization.
- Department-level authorization.
- Public display data filtering.
- WebSocket authorization.
- Audit logging.
- Secure printer communication.
- Protection against IDOR, XSS and SQL injection.

Follow existing repository security architecture.

Do not bypass AccessGuard or existing authorization policies.

The kiosk must never be granted general patient.read or administrative privileges simply to complete registration.

==================================================
11. TESTING REQUIREMENTS
==================================================

Implement unit, integration and E2E tests.

Critical test cases:

1. New patient full registration.
2. Duplicate patient detection.
3. Existing patient check-in.
4. Appointment check-in.
5. Duplicate appointment check-in.
6. Concurrent kiosk ticket generation.
7. Concurrent receptionist Call Next.
8. Multiple counter operation.
9. Queue transfer.
10. No-show.
11. Queue completion.
12. WebSocket reconnect.
13. Public display privacy.
14. Session expiration.
15. Printer failure.
16. Unauthorized kiosk API requests.
17. Unauthorized staff access.
18. Cross-facility data isolation.

Run:

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build
- pnpm test:integration

Use the repository's actual Nx targets and project names where commands differ.

==================================================
12. EXECUTION STRATEGY
==================================================

PHASE 1 — REPOSITORY AUDIT ONLY

Inspect:
- CLAUDE.md.
- Architecture documentation.
- Nx project configuration.
- Existing patient implementation.
- Existing clinic queue implementation.
- Appointment implementation.
- Database migrations.
- Drizzle schema.
- Socket.IO gateway.
- Domain event outbox.
- Staff application routes.
- Healthcare Design System.

Produce a detailed report identifying:

1. Existing reusable functionality.
2. Missing functionality.
3. Required frontend changes.
4. Required backend changes.
5. Required database changes.
6. Required hardware integrations.
7. Security implications.
8. Implementation dependencies.
9. Migration risks.
10. Recommended development phases.

Do not modify code during this phase.

Wait for approval.

PHASE 2 — BACKEND FOUNDATION

Implement approved database and domain changes.

PHASE 3 — PATIENT KIOSK

Implement registration, identification, appointment check-in and ticket generation.

PHASE 4 — RECEPTIONIST DASHBOARD

Extend existing queue management.

PHASE 5 — DISPLAY AND HARDWARE

Implement TV display, voice announcements and thermal printing.

PHASE 6 — SECURITY AND TESTING

Perform comprehensive audit and regression testing.

==================================================
13. STRICT ENGINEERING RULES
==================================================

- Do not rewrite the existing platform.
- Do not replace existing architecture.
- Do not duplicate domain services.
- Do not introduce unnecessary dependencies.
- Do not break existing API contracts.
- Do not modify unrelated modules.
- Do not introduce mock implementations in production code.
- Do not use demo fixtures for real workflows.
- Do not skip database migration validation.
- Do not bypass audit requirements.
- Do not weaken authentication or authorization.
- Do not claim tests passed unless they were executed.
- Do not proceed to the next implementation phase without approval.

Every change must be maintainable, tested, secure, and consistent with the existing Healthcare Platform.

BEGIN WITH PHASE 1: REPOSITORY AUDIT ONLY.