# Healthcare Platform

Nx + pnpm monorepo for a multi-service healthcare platform (clinic, laboratory, dental, telemedicine, billing) with a
custom **Healthcare Design System** built on shadcn/ui.

```text
Next.js ─ React ─ Tailwind CSS v4 ─ shadcn/ui (Radix) ─ Healthcare Design System
                                                          ├── Staff app   (desktop-first, dense, role-aware)
                                                          └── Patient portal (mobile-first, plain language)
```

## Getting started

```bash
pnpm install
pnpm dev:staff        # http://localhost:3000  — staff workstation
pnpm dev:portal       # http://localhost:3001  — patient portal
pnpm storybook        # http://localhost:6006  — design system
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm format
```

In the staff app, switch the **role** in the top bar (Doctor, Lab Technician, Reception…) to see the role-aware
navigation and dashboards. (Demo only: the role is a cookie; production must derive it from the authenticated session.)

## Layout

```text
apps/
├── staff/      Next.js staff application
└── portal/     Next.js patient portal
libs/
├── domain/     Clinical types (FHIR-inspired), staff roles, demo fixtures
└── ui/         Healthcare Design System (+ Storybook)
    └── src/
        ├── styles/       theme.css (tokens) · globals.css (entry)
        ├── primitives/   shadcn/Radix components tuned for density
        ├── healthcare/   PatientHeader, LabWorklist, Odontogram, PrescriptionEditor, …
        └── layouts/      StaffLayout, DoctorLayout, LaboratoryLayout, TelemedicineLayout, PatientLayout
```

Import paths: `@healthcare/ui/primitives`, `@healthcare/ui/healthcare`, `@healthcare/ui/layouts`,
`@healthcare/ui/styles.css`, `@healthcare/domain`, `@healthcare/domain/fixtures`.

## Stack

| Concern            | Choice                                                    |
| ------------------ | --------------------------------------------------------- |
| Framework          | Next.js (App Router), React 19                            |
| Styling / tokens   | Tailwind CSS v4 (`@theme`), shadcn/ui token names         |
| Primitives         | shadcn/ui on Radix UI                                     |
| Icons              | Lucide                                                    |
| Clinical tables    | TanStack Table (`LabWorklist`)                            |
| Forms              | React Hook Form + Zod (`PrescriptionEditor`)              |
| Charts             | Recharts (`LabTrendChart`)                                |
| Dates              | date-fns + facility-timezone formatting (`lib/format.ts`) |
| Toasts             | Sonner                                                    |
| Design system docs | Storybook (with a11y addon)                               |

## Design principles

1. **Information density, not a generic SaaS dashboard.** Type scale: 12 meta · 13 table · 14 body · 16–18 section ·
   20–24 page. 32px controls.
2. **Never colour alone.** Every clinical status is colour + icon + text (`⚠ Critical`). See `healthcare/status.tsx`.
3. **Patient identity always visible** in any patient context. An empty allergy list explicitly says
   "No known allergies".
4. **One workspace per job.** Patient 360, the three-column doctor encounter workspace, the lab workbench and the
   telemedicine workspace replace multi-screen flows.
5. **Clinical decision support, never silent blocking.** Drug–allergy checks (`findAllergyConflict` in `libs/domain`)
   show their evidence and allow an override with a documented reason, returned to the caller for the audit trail.
6. **Keyboard first for staff.** `/` patient search · `↑/↓` or `j/k` worklist · `Enter` next result · `F2` barcode ·
   `Alt+P` prescription · `Alt+L` lab order.
7. **Role-aware navigation.** `navigationForRole()` filters `STAFF_NAVIGATION`.
8. **Action-first dashboards.** "What do I need to do next?" (`AttentionList`, `ActionMetric`) rather than charts.
9. **Facility time, always.** Clinical times render in the facility timezone (`setClinicTimeZone`, default
   `Asia/Manila`), never the server's.
10. **Staff and patients get different products.** The portal is mobile-first with a bottom tab bar, 16px base text and
    plain-language results.

## Screens (staff app)

| Route                         | Screen                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/`                           | Role-specific dashboard (doctor · lab · front desk)                                                                |
| `/patients`, `/patients/[id]` | Patient list · **Patient 360** (overview, encounters, labs, meds, care plan, dental, documents, billing, timeline) |
| `/clinic/encounters/[id]`     | **Doctor workspace** — history · encounter note · clinical context, collapses to tabs < 1280px                     |
| `/laboratory/worklist`        | **Lab workbench** — TanStack worklist + result entry, auto-flagging, verify/critical/reject                        |
| `/dental`                     | **Odontogram** (FDI) with per-surface charting                                                                     |
| `/telemedicine/[id]`          | Video consult with the patient record alongside                                                                    |
| `/queue`, `/appointments`     | Queue board · daily schedule                                                                                       |

Modules in the navigation that aren't built yet render a placeholder.

Data flows through `apps/staff/src/lib/data.ts`; swap the fixtures for FHIR/REST calls there.
