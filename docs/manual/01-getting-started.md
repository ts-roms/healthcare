# 1. Getting started

**What this is for.** This chapter covers the basics every staff member needs: how to sign in (including the verification code from an authenticator app), how to
choose your organization and facility, how to find your way around, what the dashboard shows, how on-screen statuses and times work, and how to sign out safely.

**Who uses it.** Everyone who uses the staff app: receptionists, nurses, physicians, dentists, medical technologists, pathologists, phlebotomists, pharmacists,
cashiers, inventory officers, records officers and administrators. Patients use a different app, MyHealth (see [Patient portal](12-patient-portal.md)).

## How to sign in

1. Open the staff app. If you are not signed in, you see the **Staff sign-in** page.
2. Enter your **Email** and **Password**, then select **Sign in**.
3. If you belong to more than one organization, the page asks you to choose one. Pick it from **Organization** ("Choose where you are working…"), enter your
   **Password** again and select **Sign in**.
4. If your account uses two-step verification, the page says "Enter the 6-digit code from your authenticator app." Type the current code in **Verification
   code** (or one of your recovery codes) and select **Verify and sign in**. Do this within 5 minutes. After that the attempt expires and you start again with your password.
5. You land on the **Dashboard**. If you were opening a specific page when you were asked to sign in, you usually go back to that page.

> Two-step verification uses a TOTP authenticator app on your phone. Turn it on under **My account** (below). If your organization requires it and yours is
> not on yet, every page shows **Set up two-step verification** after you sign in: set it up there, and the page you asked for opens.

## How to choose your facility

Much of the work is kept per facility: the queue, appointments, charges and invoices, the laboratory workbench, stock and patient registration. The app sends
the facility you choose with everything you do.

1. Find the facility selector in the top bar, next to the bell icon. It shows **Select facility…** until you choose one.
2. Pick your facility. The page reloads for that facility.

- If your organization has only one active facility, it is selected for you when you sign in.
- Your choice is kept until you sign out. It is cleared when you sign out.
- The selector appears on tablet-sized and larger screens only. On a phone-sized window, widen the window or use a larger screen to switch facility.
- Screens that need a facility show a yellow note, for example "Select your facility in the top bar first." Registration says "Patients are registered at a
  facility."
- The selector lists the facilities where you hold a role (all of them if your role covers the whole organization). If you don't see a facility selector
  at all, you have no role in any active facility. Ask your administrator.

## How to find your way around

The dark **sidebar** on the left lists the modules you may use. It is built from your permissions, so two people can see different menus. On a small screen,
open it with the menu button (**Open navigation**) at the top left.

- Selecting a module that has sub-pages (for example **Laboratory**) opens its first sub-page. The sub-pages appear under the module while you are in it.
- **Dashboard** is always shown.
- Sub-pages you cannot open are not listed (for example **Quality control** needs `lab.qc.read`), and a module whose sub-pages are all out of
  reach is not shown at all.
- A menu entry for a module that is not built yet would lead to a page that says "This module is part of the platform roadmap and is not built
  yet." No entry in the current menu leads there.

What each default role usually sees in the sidebar, besides **Dashboard**:

| Role                       | Modules in the sidebar                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization administrator | Patients, Appointments, Queue, Clinic, Laboratory, Dental, Telemedicine, Billing, Pharmacy, Inventory, Communications, Disease reporting, Records, Administration |
| Physician, Dentist         | Patients, Appointments, Queue, Clinic, Laboratory, Dental, Telemedicine, Communications, Disease reporting                                                        |
| Nurse                      | Patients, Appointments, Queue, Clinic, Laboratory, Dental, Telemedicine, Pharmacy, Inventory                                                                      |
| Dental assistant           | Patients, Appointments, Queue, Clinic, Laboratory, Dental, Telemedicine, Inventory                                                                                |
| Receptionist               | Patients, Appointments, Queue, Telemedicine, Billing, Communications                                                                                              |
| Medical records officer    | Patients, Appointments, Clinic, Laboratory, Disease reporting, Records                                                                                            |
| Medical technologist       | Patients, Laboratory, Inventory                                                                                                                                   |
| Pathologist, Phlebotomist  | Patients, Laboratory                                                                                                                                              |
| Pharmacist                 | Patients, Pharmacy, Inventory                                                                                                                                     |
| Cashier                    | Patients, Billing                                                                                                                                                 |
| Inventory officer          | Inventory                                                                                                                                                         |
| Auditor                    | Dashboard only                                                                                                                                                    |

Your organization may give you a custom role, or more than one role, so your menu can differ. Seeing a menu entry does not mean you can do everything in it:
buttons you may not use are hidden, and the server checks every action again. The full list of roles and permissions is in
[Administration](13-administration.md).

## How to use the top bar

From left to right:

- **Search box** ("Search patients: name, patient no. or mobile…"). Type a patient's name, patient number or mobile number and press Enter. You go to the **Patients**
  search results. Press the `/` key anywhere (outside a text field) to jump to the search box. See [Patients](02-patients.md).
- **Facility selector** (see above).
- **Bell** — your in-app notifications. A number on the bell shows how many are unread ("99+" above 99).
- Your **name** and **organization** (on wide screens; a person icon on narrow ones) — opens **My account** (see below).
- **Sign out** button (the exit icon). Hover over it to see which email is signed in.

## How to change your password or turn on two-step verification

Click your name in the top bar to open **My account** (`/account`).

- **Password:** enter your current password, then the new one twice (at least 12 characters, not repetitive), and click **Change password**.
  You stay signed in here; every other session of yours is signed out.
- **Two-step verification:** click **Turn on**. In an authenticator app on your phone (for example Google Authenticator or Microsoft
  Authenticator), add an account with the setup key shown (on a phone you can open it directly in the app). Type the 6-digit code the app shows
  and click **Turn on**. The page then shows your 10 **recovery codes** — only this once. Write them down or print them, keep them away from your
  phone, and click **I have saved them**. From then on, signing in also asks for a code. Each code works once: if a code is refused, wait for the
  next one the app shows. To turn it off, click **Turn off…** and enter your password and a current code (or a recovery code). If your
  organization requires two-step verification, the page says so and it cannot be turned off.
- **Recovery codes:** without your phone, type a recovery code instead of the 6 digits when signing in; each works once. **My account** shows how
  many are left. **New recovery codes…** (your password and a code from the app) makes a new set, and the old ones stop working.

**Forgot your password?** On the sign-in page, select **Forgot your password?**, enter the email you sign in with and select **Send me a link**. Open
the link in the email within 30 minutes (it works once), enter the new password twice — and, if you use two-step verification, a code from your app or a recovery code —
then **Save new password**. You are signed out everywhere and sign in with the new password.

If you lose your phone and have no recovery codes left, ask your administrator to **reset** your two-step verification. You are signed out, and you set it up again at your next sign-in.
If the email does not arrive, your administrator can give you a temporary password in person. After signing in with it, every page shows **Choose your
own password**: enter the temporary password, then your new one twice, and select **Choose this password**.

## How to read your notifications

Selecting the bell opens **Notifications** (`/notifications`). These are messages the platform sent you inside the app, such as laboratory notices, quality
events and staff messages. The latest 100 are kept.

1. Unread messages have a **New** badge.
2. Select **Open** to mark a message read and go to the page it is about.
3. Select **Mark read** to mark it read without leaving the list.

When there are none, the page says "No notifications."

## How to use the dashboard

The **Dashboard** (`/`) greets you by name and shows your organization and selected facility. What you see depends on your permissions and needs a selected
facility.

- **Find patient** and **Register patient** buttons (with `patient.search` and `patient.register`).
- **Clinic today** (with `clinic.dashboard.read`):
  - Figures: **Appointments**, **Waiting**, **With provider**, **Seen**, **Average wait** and **No-show rate**. Select a figure to open its screen.
  - **Attention required**: for example "Long wait in the queue" (someone waiting more than 45 minutes), "Unsigned encounters", "Left without being seen
    today", "Overdue care-plan activities" and "Care-plan activities due this week". When the list is empty it says "Nothing needs your attention."
  - **Your next patients** (if your account is linked to a practitioner) or **Next patients**, with a **Full schedule** link.
  - **Provider workload** (Booked, Seen, Waiting per practitioner) and the live queue board.
- **Laboratory** (with laboratory permissions): **To collect**, **Awaiting results**, **Awaiting sign-off**, **STAT open**, **Released today**, **Avg.
  turnaround** and **Rejected today**, plus "Critical results not yet acknowledged" and "Tests past their turnaround time". Quality staff also see a
  **Laboratory quality** list. See [Laboratory](06-laboratory.md) and [Laboratory quality](07-laboratory-quality.md).

The small indicator next to **Clinic today** tells you how the figures update:

| Indicator              | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| **Live**               | Changes appear as they happen.                                             |
| **Connecting…**        | The live connection is starting.                                           |
| **Updates every 15 s** | The live connection is not available; the page refreshes every 15 seconds. |

## How statuses, dates and times are shown

- **Status is never shown by colour alone.** Every clinical status has a colour, an icon and a word, for example **Critical high** with a warning icon. Read the
  word, not just the colour.
- **Allergy statements are precise.** "No known allergies" appears only after someone recorded that review with the patient. A patient never asked shows
  "Allergies not recorded — ask the patient". If you may not see clinical data, you see "Allergies: no access". Never read a missing allergy badge as "no
  allergies".
- **Dates** are written like `27 Sep 2026`. **Times** use the 24-hour clock (`14:05`) in the time zone of the facility you selected (Asia/Manila unless your organization set another for that facility; also Asia/Manila
  before you select one). Birth dates and due dates are calendar
  dates and do not shift.
- **Money** is in Philippine pesos (₱).
- **Demo data.** A screen marked **Demo** with a yellow "Demo data." banner shows sample patients only. It is a design preview, is not connected to the patient
  record, and saves nothing. The patient 360 preview (`/preview/patient-360`) is such a screen. Never use it for real patients.
- **Tab titles never show patient names** (for example "Patient record"), to protect privacy on shared screens and in browser history.

## How to sign out

1. Select the **Sign out** icon at the right end of the top bar.
2. You return to the sign-in page. Your session is ended on the server and your facility choice is cleared.

Always sign out of a shared workstation. The staff app does not sign you out after a period of inactivity.

## How sessions end

- While you work, your session renews itself in the background. You do not need to do anything.
- A session ends when you sign out, when your password is changed, when an administrator suspends your access, or when it reaches its maximum age (14 days by
  default; your organization's deployment can set this). The next action then takes you to sign-in with the note "Your session ended. Sign in again to
  continue."
- If the server is busy or down, you may see "The patient record service is busy". Your session is still active and the page retries by itself every 10
  seconds. You can also select **Retry now**.

## Rules the system enforces

- Passwords must have at least 12 characters.
- A new password is checked against passwords known from data breaches elsewhere. If it is one of them you see "This password has appeared
  in a data breach elsewhere" — choose a different one. If the check cannot be done right now you see "We couldn't check this password right
  now" — nothing was changed; try again in a few minutes.
- After 5 wrong attempts in a row (wrong password or wrong verification code), the account is locked for 15 minutes.
- Sign-in and other credential requests are rate limited (about 10 a minute from one device).
- The sign-in page never tells you whether an email exists, so a typo in your email gives the same message as a wrong password.
- Every action is checked on the server with your permissions and facility, even if a button is visible.
- The live queue and laboratory updates reach you only if you may see the queue or the laboratory at that facility.

## Troubleshooting / common messages

| Message                                                                             | Meaning                                                                           | What to do                                                                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Enter your email and password.                                                      | A field was empty.                                                                | Fill in both fields.                                                                             |
| Invalid email or password                                                           | The email or password is wrong (or the email is unknown).                         | Check your email for typos and try again. After 5 failures the account locks for 15 minutes.     |
| Too many failed attempts. Try again later.                                          | The account is locked after repeated failures.                                    | Wait 15 minutes. If it keeps happening, tell your administrator.                                 |
| This account is disabled                                                            | Your user account is disabled.                                                    | Contact your administrator.                                                                      |
| Your account has no active organization access                                      | Your membership in the organization is suspended or ended.                        | Contact your administrator.                                                                      |
| You belong to more than one organization. Choose one and enter your password again. | Your email is a member of several organizations.                                  | Choose the organization and re-enter your password.                                              |
| Enter the 6-digit code from your authenticator app.                                 | The code field is empty or not 6 digits.                                          | Type the current 6-digit code.                                                                   |
| Invalid verification code                                                           | The code was wrong or too old.                                                    | Wait for a new code in your app and try again. Check that your phone's clock is correct.         |
| Your sign-in attempt expired. Enter your password again.                            | More than 5 minutes passed between password and code.                             | Start again from the password.                                                                   |
| Your session ended. Sign in again to continue.                                      | You were signed out (expired, signed out elsewhere, password changed, suspended). | Sign in again.                                                                                   |
| Select your facility in the top bar first.                                          | This screen works per facility.                                                   | Choose your facility in the top bar.                                                             |
| Could not switch facility.                                                          | The facility change did not save.                                                 | Reload the page and try again.                                                                   |
| The patient record service is busy                                                  | The server is overloaded or unavailable.                                          | Wait; the page retries every 10 seconds.                                                         |
| You do not have permission to perform this action                                   | Your role does not include this action here.                                      | Ask your administrator if you need it. The reference code "(ref …)" helps them find the request. |
| The server could not be reached. Try again.                                         | Network problem between the app and the server.                                   | Check your connection and retry.                                                                 |

Many error messages end with "(ref xxxxxxxx)". Give that reference to your administrator or IT support when you report a problem.

## Related chapters

- [Patients](02-patients.md)
- [Appointments and queue](03-appointments-and-queue.md)
- [Laboratory](06-laboratory.md)
- [Patient portal (MyHealth)](12-patient-portal.md)
- [Administration](13-administration.md)
- [Glossary and FAQ](14-glossary-and-faq.md)
