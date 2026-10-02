# User Manual

This manual explains how to **use** the healthcare platform: the staff app (clinic, laboratory, dental, pharmacy, inventory, billing, records) and
**MyHealth**, the patient portal. It is written for the people who work in the clinic and for patients.

The same pages are in the apps: **Help** in the staff app's menu (`/help`), and **How to use MyHealth** on the MyHealth sign-in page and the
**Help** button in its header (`/help`, chapter 12 without its staff sections, readable before signing in). Edit the files here and the
apps show the change on their next deployment.

Developers and system operators should read the technical documentation instead: [architecture](../architecture/overview.md),
[domains](../domains/), [interoperability](../interoperability/), [deployment](../deployment/local-development.md).

## Chapters

| #   | Chapter                                                                                 | For                                                                     |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | [Getting started](01-getting-started.md)                                                | Everyone on staff — sign-in, MFA, facility, navigation, notifications   |
| 2   | [Patients](02-patients.md)                                                              | Reception, nurses, physicians, records officers                         |
| 3   | [Appointments and queue](03-appointments-and-queue.md)                                  | Reception, nurses, physicians                                           |
| 4   | [Consultations and care plans](04-consultations-and-care-plans.md)                      | Physicians, nurses                                                      |
| 5   | [Telemedicine](05-telemedicine.md)                                                      | Physicians, reception                                                   |
| 6   | [Laboratory](06-laboratory.md)                                                          | Phlebotomists, medical technologists, pathologists, ordering clinicians |
| 7   | [Laboratory quality](07-laboratory-quality.md)                                          | Medical technologists, laboratory quality managers                      |
| 8   | [Dental](08-dental.md)                                                                  | Dentists, dental assistants                                             |
| 9   | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                  | Pharmacists, nurses, inventory officers                                 |
| 10  | [Billing](10-billing.md)                                                                | Cashiers, billing staff                                                 |
| 11  | [Records, disease reporting and integrations](11-records-reporting-and-integrations.md) | Records officers, physicians, administrators                            |
| 12  | [MyHealth patient portal](12-patient-portal.md)                                         | Patients (and staff who help them)                                      |
| 13  | [Administration](13-administration.md)                                                  | Organization administrators                                             |
| 14  | [Glossary and FAQ](14-glossary-and-faq.md)                                              | Everyone                                                                |

## Find a task quickly

| I want to…                                 | Go to                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Register a new patient                     | [Patients → registration](02-patients.md)                                                                    |
| Keep working when the internet is down     | [Appointments and queue → Offline page](03-appointments-and-queue.md#when-the-internet-is-down-offline-page) |
| Send a message to a group of patients      | [Outreach](11-records-reporting-and-integrations.md#how-to-send-an-outreach-campaign)                        |
| Book an appointment or check a patient in  | [Appointments and queue](03-appointments-and-queue.md)                                                       |
| Take vital signs at triage                 | [Appointments and queue → triage](03-appointments-and-queue.md)                                              |
| Write and sign a consultation note         | [Consultations](04-consultations-and-care-plans.md)                                                          |
| Prescribe, or order laboratory tests       | [Consultations](04-consultations-and-care-plans.md)                                                          |
| Collect a specimen and print its label     | [Laboratory](06-laboratory.md)                                                                               |
| Enter, verify, approve and release results | [Laboratory](06-laboratory.md)                                                                               |
| Record a QC run or a fridge temperature    | [Laboratory quality](07-laboratory-quality.md)                                                               |
| See reagent use and cost per test run      | [Laboratory quality](07-laboratory-quality.md)                                                               |
| Chart teeth or record a dental procedure   | [Dental](08-dental.md)                                                                                       |
| Dispense a prescription                    | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                                       |
| Receive stock or raise a purchase order    | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                                       |
| Issue an invoice and take payment          | [Billing](10-billing.md)                                                                                     |
| Give a patient access to MyHealth          | [Patients → patient portal access](02-patients.md)                                                           |
| Help a patient activate MyHealth           | [MyHealth patient portal](12-patient-portal.md)                                                              |

## How to read this manual

- **Bold text** is exactly what you see on screen, for example **Check in (walk-in)**.
- Paths such as `/queue` are the address of a screen in the staff app (after the site address).
- You only see menus and buttons your role allows. If a step mentions a button you don't have, ask your organization administrator — the
  permission it needs is named in the step (for example `patient.register`).
- Clinical times are shown in the facility's time zone (Asia/Manila unless your organization set another).
- Status is always shown with colour **and** an icon **and** a word — never rely on colour alone.

## What the platform does not do (yet)

Some features depend on outside systems whose official specifications are not yet available. The platform prepares and records these,
but does not transmit them until an adapter is configured:

- **PhilHealth** eClaims, eligibility inquiries and YAKAP submissions — staff record PhilHealth's answers from PhilHealth's own channel.
- **DOH** disease reports — staff record them as reported through DOH's own channel.
- **Online payment** — no payment provider is configured by default.
- **Reference laboratories** — send-outs are tracked with printed manifests; results are entered by hand.

The platform assists healthcare professionals. Decision support (for example drug–allergy warnings) is labelled as such and never replaces
clinical judgement. Having a feature does not mean a regulatory requirement is met — compliance must be validated with the relevant
authority before production use.
