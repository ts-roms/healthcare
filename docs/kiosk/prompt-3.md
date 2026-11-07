# Phase 3 — Patient Self-Service Kiosk Frontend

Implement the complete touchscreen kiosk interface using the existing React + TypeScript frontend architecture.

## Design Requirements

Create a professional hospital kiosk experience.

The design must be:

- Modern.
- Clean.
- Accessible.
- Touchscreen optimized.
- Responsive.
- Easy to understand for elderly patients.
- Consistent with existing Healthcare Management Platform branding.

Use the existing UI component library and design tokens.

## Required Pages

1. KioskWelcomePage
2. PatientTypePage
3. PatientRegistrationPage
4. ExistingPatientPage
5. AppointmentCheckInPage
6. ServiceSelectionPage
7. RegistrationReviewPage
8. QueueTicketPage

## Full Registration Form

Implement:

- Personal information.
- Date of birth.
- Sex according to the existing patient model.
- Contact information.
- Address.
- Emergency contact.
- Hospital-required registration information.
- Privacy notice and acknowledgements.

Use React Hook Form and Zod if compatible with the existing project.

## Existing Patient Workflow

- Identify patient using approved identifiers.
- Perform additional identity verification.
- Display masked identification details.
- Prevent duplicate records.
- Submit check-in request.

## Appointment Workflow

- Search appointment using approved identifiers.
- Verify patient and appointment ownership.
- Check appointment status and check-in eligibility.
- Prevent duplicate check-ins.
- Generate appropriate queue ticket.

## Ticket Screen

Display:

- Queue number.
- Department.
- Date and time.
- Registration status.
- Instructions.
- Optional QR code.

Implement thermal ticket printing integration through the approved print mechanism.

## Kiosk Security

- Full-screen mode.
- Session timeout.
- Automatic form reset.
- No sensitive information in local storage.
- No patient information remaining after session termination.
- Restricted API access.

## Deliverables

- Complete React pages.
- Reusable components.
- API integration.
- Form validation.
- Loading and error states.
- Accessibility considerations.
- Automated frontend tests.

Do not create static mock screens in place of working functionality.
