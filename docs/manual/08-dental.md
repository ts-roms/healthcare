# 8. Dental

## What this is for

The dental module keeps each patient's dental record on the same patient record as the rest of the clinic: the tooth chart (odontogram) and its
history, examinations, periodontal charts, treatment plans, procedures done, the supplies they used, and radiographs and photos. A dental visit is a
normal clinic consultation with a dentist, so notes, diagnoses, prescriptions and laboratory orders are written in the encounter workspace as for
any consultation (see [Consultations and care plans](04-consultations-and-care-plans.md)). The dental module adds only what is specific to
dentistry.

## Who uses it

- **Dentists** — chart examinations, record periodontal charts, propose treatment plans, record the patient's decision, record procedures and the
  supplies used, add and share images, correct mistakes.
- **Dental assistants** — view the dental record, open and upload images.
- **Physicians and nurses** — view the dental record (read only).
- **Organization administrators** — everything above, plus **Dental settings** (procedure list, tooth notation, supplies per procedure, MyHealth
  options).

Recording examinations, periodontal charts, treatment plans and procedures also needs your user account to be linked to an active practitioner
whose profession is **dentist**. If it is not, the system answers "Only a dentist can record this" — ask your administrator to link your account.

| Permission                     | What it allows                                                                | Default roles                                          |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `dental.record.read`           | See **Dental** in the menu and open a dental record                           | org_admin, dentist, dental_assistant, physician, nurse |
| `dental.chart.write`           | **Chart examination**, **Record periodontal chart**, **Start dental visit**   | org_admin, dentist                                     |
| `dental.treatment-plan.manage` | **New plan**, **Record decision**, **Cancel item**, **Discontinue plan…**     | org_admin, dentist                                     |
| `dental.procedure.record`      | **Record procedure**, supplies used and returns                               | org_admin, dentist                                     |
| `dental.record.write`          | **Entered in error…** on examinations, periodontal charts, procedures, images | org_admin, dentist                                     |
| `dental.imaging.read`          | **Open** an image                                                             | org_admin, dentist, dental_assistant                   |
| `dental.imaging.upload`        | **Upload** an image (also needs `document.upload`)                            | org_admin, dentist, dental_assistant                   |
| `dental.imaging.release`       | **Share in MyHealth** and **Stop sharing…**                                   | org_admin, dentist                                     |
| `dental.settings.manage`       | Change anything on **Dental settings**                                        | org_admin                                              |

## Key ideas

- **Teeth are stored in FDI numbering** (11–48 for permanent teeth, 51–85 for primary teeth). The chart shows them in your facility's chosen
  notation: FDI, Universal or Palmer. Wherever you **type** a tooth number (procedures, plan items, images) you type the **FDI** number, for example
  `16` for the upper right first molar. When the facility uses another notation, the field shows what the number means (for example "= 3").
- **Surfaces** are M (mesial), D (distal), O (occlusal, premolars and molars only), I (incisal, incisors and canines only), B (buccal / labial) and L
  (lingual / palatal). The system only accepts surfaces the tooth actually has.
- **History is never overwritten.** Each examination or procedure adds a new state for the teeth it touches. The chart you see is the latest state
  of each tooth. A mistake is corrected by marking the record **Entered in error**; it stays in the history, struck through, and the tooth shows its
  previous state again.
- **You need an open dental visit** to chart, record a periodontal chart or record a procedure. The visit is a consultation in progress at your
  selected facility, conducted by a dentist.

## How to find today's dental patients

1. Select your facility in the top bar (see [Getting started](01-getting-started.md)).
2. Open **Dental** → **Today's patients** (`/dental`).
3. The list shows each dentist's consultation today: time, patient, chief complaint, dentist, whether the patient was charted (**Charted** or **Not
   charted**), the number of procedures, and the status (**In progress** or **Signed**).
4. Click the patient's name to open the dental record.

If the list is empty you see "No dental consultations yet. Start one from the queue (Consultations) or from a patient's dental record." Use
**Find a patient** to search for someone who is not on the list.

## How to open a patient's dental record

- From **Dental** (`/dental`), click the patient's name, or
- from the patient record (`/patients/[id]`), click **Dental record**.

The page `/dental/patients/[id]` shows, from top to bottom: the **Dental chart**, **Treatment plans**, **Procedures**, **Examinations**,
**Periodontal charts** and **Imaging**. The header has **Notes & prescriptions** (the encounter workspace of the visit in progress) and **Patient
record**.

## How to start a dental visit

Most dental visits start from the queue like any consultation (see [Appointments and queue](03-appointments-and-queue.md)). If the patient did not
come through the queue:

1. Open the patient's dental record.
2. Optionally type a **Chief complaint (optional)**.
3. Click **Start dental visit**. The message "Dental visit started" appears, and the header shows **Dental visit in progress since** and the time.

**Start dental visit** appears only when you have a facility selected and have both `encounter.write` and `dental.chart.write`. The visit is
created for you, so your account must be linked to a practitioner.

## How to chart an examination

1. Open the dental record during the patient's visit.
2. In **Dental chart**, choose the dentition: **Permanent**, **Mixed** or **Primary**.
3. Click **Chart examination**. (It is greyed out with the hint "Start or open the patient's dental visit first" when there is no visit in
   progress.)
4. Click a tooth. In the panel on the right, choose its findings: **Caries**, **Restoration**, **Sealant**, **Fracture**, **Crown**, **Root canal**,
   **Watch**, **Missing**, **Implant**, **Pontic**, **Impacted**, **Unerupted**. For caries, restorations and sealants, choose the surfaces. Add a
   **Note** for the tooth if needed.
5. Repeat for each tooth you examined. Teeth you do not change keep their current state. A tooth you chart with no findings is recorded as sound.
   The page counts how many teeth you changed.
6. Optionally set **Oral hygiene** (**Good**, **Fair**, **Poor**, or **Not assessed**) and write **Examination notes** (history, soft tissues,
   occlusion, periodontal findings).
7. Click **Record examination**. The message tells you how many teeth were charted. Click **Discard** to leave without saving.

**Record examination** stays disabled until you change at least one tooth, or write notes, or set oral hygiene. Problems the system would refuse
(for example "Tooth 16: choose the caries surfaces.") are listed above the button.

## How to see a tooth's history

1. Click a tooth on the chart (not in charting mode).
2. The right panel shows the tooth's current findings, where they came from (an examination or a procedure), when and by whom.
3. Click **History** to list every state of the tooth, newest first. States from records marked entered in error are struck through and labelled
   **Entered in error**. "Never charted." means the tooth has no history.

## How to record a periodontal chart

1. During the patient's visit, in **Periodontal charts**, click **Record periodontal chart**.
2. The form lists one row per tooth. Teeth charted as missing or unerupted on the odontogram are left out.
3. For each tooth you probe, enter per site (MB, B, DB, ML, L, DL):
   - **Depth (mm)** — probing depth, 0–20.
   - **Margin (mm)** — gingival margin relative to the CEJ, −10 to 20 (positive = recession, negative = margin above the CEJ).
   - Tick bleeding (**b**), plaque (**p**) and suppuration (**s**).
4. Enter **Mob.** (mobility 0–3) and, on teeth that have a furcation, **Furc.** (0–3). Other teeth show "—".
5. Add **Notes** if needed and click **Record chart**.

Teeth you leave empty are not recorded as examined. To view a chart, click **View**: you see the measurements (depths of 4 mm or more in bold) and,
compared with the previous chart, the sites that became **Deeper by 2 mm or more** or **Shallower by 2 mm or more**.

The summary (bleeding and plaque percentages, sites ≥ 4 mm and ≥ 6 mm, deepest pocket, mean attachment level) is a measurement aid only. The system
does **not** stage or grade periodontitis — record your diagnosis in the visit's notes and diagnoses.

## How to propose a treatment plan

1. In **Treatment plans**, click **New plan**.
2. Enter a **Title**, for example "Restorative phase and hygiene".
3. For each item choose the **Phase** (1–5), the **Procedure**, and — as the procedure requires — the **Tooth (FDI)** and **Surfaces**. Add a
   **Note** if needed.
4. Click **Add item** for more items; remove one with the bin icon.
5. Click **Propose plan**. The plan appears as **Proposed — awaiting the patient's decision**.

Plans carry no prices of their own: fees come from billing's price list. An open plan shows a **Fee estimate** of the work still ahead — each
item awaiting a decision or accepted and not yet done at today's listed price, the totals, and "No listed price" for a procedure whose code has
no priced billing service (map it in billing settings). Discounts, packages and HMO or PhilHealth coverage are not applied. Click **Print
estimate** for a copy the patient can take home and sign. Once the patient decides, each item shows "Estimate at decision" — the price it had
that day.

## How to record the patient's decision

1. On the plan, tick the items the patient **accepts**. Unticked items will be recorded as declined.
2. In **Patient's decision (ticked items accepted, others declined)**, write how the patient decided, for example "options and fees explained;
   consent form signed".
3. Click **Record decision**. The message is "Decision recorded" (or "Plan declined" if you ticked nothing).

The plan then shows the decision under the items. If the organization allows decisions in MyHealth and the patient decided there, the plan shows
"Decided by the patient in MyHealth" with the text the patient confirmed.

Plan statuses: **Proposed — awaiting the patient's decision**, **Accepted**, **In progress**, **Completed**, **Declined**, **Discontinued**. Item
statuses: **Proposed**, **Accepted**, **Declined**, **Done**, **Cancelled**.

## How to change a plan

- **Cancel an item** — click **Cancel item** on a proposed or accepted item. You cannot cancel the plan's last open item: record the patient's
  decision or discontinue the plan instead.
- **Discontinue the plan** — on an accepted or in-progress plan, click **Discontinue plan…**, type the reason (at least 5 characters, for example
  "patient transferred to another clinic") and click **Discontinue**. Open items are cancelled; completed items stay. **Keep plan** closes the box.

## How to record a procedure

1. During the patient's visit, go to **Procedures**.
2. If the procedure carries out an accepted plan item, choose it in **From a treatment plan**. The procedure, tooth and surfaces are filled in for
   you. Otherwise leave **Not from a plan**.
3. Choose the **Procedure**. Each shows what it is recorded against: **Whole mouth**, **Tooth** or **Tooth surfaces**.
4. Enter the **Tooth (FDI)** and choose the **Surfaces** if the procedure asks for them.
5. Optionally add **Notes** (material, anaesthesia, remarks).
6. Click **Record procedure**. The message says the procedure was recorded and asks you to confirm the supplies used; the **Supplies used** panel
   opens (see below).

What happens next:

- If the procedure changes the chart (for example a restoration, crown, root canal or extraction), the tooth gets a new state.
- A plan item it carries out becomes **Done**.
- Billing charges the procedure if a billing service is mapped to its code ("When a dental procedure is performed" in billing settings; see
  [Billing](10-billing.md)). Dentistry itself sets no price.

If there is no visit in progress you see "Procedures are recorded during the patient's dental visit."

## How to record the supplies a procedure used

Supplies are taken from the facility's inventory stock when you confirm them.

1. After recording a procedure, the **Supplies used** panel opens. (For an earlier procedure, click **Supplies** on its row.)
2. Under **Confirm the supplies used**, the list is prefilled from the procedure's template in **Dental settings**. If there is no template you see
   "No template for this procedure — add what was used."
3. Choose where the stock is **Taken from** (the facility's default location is offered first).
4. Change the list to what was actually used: pick a supply, change the quantity, **Add supply**, or remove a line with ×. Each line shows the stock
   unit and how much is usable at that location.
5. For a controlled item, fill in the **Reason (controlled item)** and **Reference (e.g. register entry)**.
6. Click **Issue from stock**. The message is "Supplies issued from stock".

The panel then lists each issue with the item, quantity, lot number and expiry, and a status badge: **Used**, "N returned", or **Returned**. You can
record more supplies later with **Record more supplies used**.

Either **all** lines are issued or **none**. If one line cannot be issued you see "Nothing was issued. Check the supplies marked below." and the
problem is shown next to that supply.

Supplies are not charged separately. Recording supplies needs `dental.procedure.record`, so dental assistants cannot do it with the default roles.

## How to return unused supplies

1. Open the procedure's **Supplies** panel.
2. Click **Return unused supplies…**.
3. For each line, enter the quantity to return (up to what is still out).
4. Type a reason (at least 3 characters, for example "not opened") and, for controlled items, a reference.
5. Click **Return to stock**. The message is "Unused supplies returned to stock".

Stock goes back to the same lot at the location it was issued from. Return to one location at a time.

## How to add, open and share images

**Add an image**

1. In **Imaging**, choose the **File** (JPEG, PNG, HEIC, TIFF or DICOM; the staff app accepts files up to 10 MB).
2. Choose the **Kind**: **Periapical**, **Bitewing**, **Panoramic**, **Cephalometric**, **Occlusal**, **CBCT**, **Intraoral photo**, **Extraoral
   photo** or **Other**.
3. Type the **Teeth (FDI)** shown, separated by spaces (for example `36 37`), and the date **Taken on** (not in the future).
4. Add **Notes** if needed and click **Upload**. The message is "Image added".

If the file was stored but could not be added to the record, the button changes to **Add stored file**; click it to try again without uploading
the file a second time.

**Open an image** — click **Open**. A short-lived private link opens in a new tab. Every opening is recorded in the audit trail.

**Share an image in MyHealth** — click **Share in MyHealth**. The image shows **Shared in MyHealth**. If the organization does not show dental
records in MyHealth, the badge reads **Shared in MyHealth (records off)** and the patient does not see it yet. To stop sharing, click **Stop
sharing…**, type the reason (at least 5 characters) and click **Stop sharing**. Patients are not notified when an image is shared.

## How to correct a mistake (entered in error)

Examinations, periodontal charts, procedures and images cannot be edited or deleted. To correct one:

1. Click **Entered in error…** on the record.
2. Type the reason (at least 5 characters, for example "wrong tooth recorded").
3. Click **Confirm**.

The record stays, struck through and labelled **Entered in error** (hover to see the reason). Its tooth states leave the current chart. For a
procedure:

- its plan item opens again, so it can be carried out later;
- billing cancels its charge if it is not yet on an invoice (an invoiced charge needs the invoice voided — see [Billing](10-billing.md));
- supplies it used are **not** put back automatically. Return unused ones with **Return unused supplies…**; no more supplies can be recorded for
  it.

An image marked entered in error is also no longer shared in MyHealth.

## How to set up dental settings

Open **Dental** → **Settings** (`/dental/settings`). Everyone with `dental.record.read` can view it; changing it needs `dental.settings.manage`.

**Procedures** — the organization's own list. No national dental code set is assumed; use your clinic's own codes.

1. Under **Add a procedure**, type the **Code** (lowercase letters, digits and dashes, for example `composite-1s`) and the **Name**.
2. Choose **Recorded against**: **Whole mouth**, **Tooth** or **Tooth surfaces**.
3. Choose what it **Changes the chart to** (**Nothing**, or for surfaces **Restoration** / **Sealant**, for teeth **Crown**, **Root canal**,
   **Missing (extraction)**, **Implant**, **Pontic**). Whole-mouth procedures cannot change the chart.
4. Click **Add procedure**.

Code, site and chart effect cannot be changed later. Use **Deactivate** / **Reactivate** to take a procedure out of use.

**Tooth notation** — how teeth are numbered on screen at the selected facility: **FDI (ISO 3950)**, **Universal** or **Palmer**. Records are
always stored in FDI.

**Supplies per procedure** — click **Edit** next to a procedure, add inventory items and quantities with **Add supply**, and click **Save**. This is
only a starting list: staff confirm what was used each time. Only items dentistry may use are offered (dental and medical supplies, medicines, PPE
and other — never laboratory reagents).

**Supplies taken from** — the stock location offered first at the selected facility (or **No default**).

**Dental records in MyHealth** — off by default, for the whole organization. Click **Show in MyHealth** to let patients with MyHealth access see
their treatment plans, procedures done and a plain summary of their tooth chart. Notes, periodontal charts, procedure codes and anything entered in
error are never shown; images only when a dentist shares them. Click **Stop showing in MyHealth** to turn it off.

**Treatment plan decisions in MyHealth** — appears only when dental records are shown. Write **What the patient confirms** (at least 20
characters, your clinic's own wording — the platform supplies none) and click **Allow online decisions**. Use **Save text** to change the wording
and **Stop online decisions** to turn it off. Whether an online acknowledgement is enough for a given treatment is for your clinic to decide.

What patients see is described in [MyHealth patient portal](12-patient-portal.md).

## Rules the system enforces

- Charting, periodontal charts and procedures need a dental visit **in progress** for that patient at your selected facility, and a user linked to
  a dentist practitioner.
- Tooth numbers must be valid FDI codes; surfaces must exist on that tooth (for example no occlusal surface on an incisor).
- Missing, pontic, impacted and unerupted cannot be combined with other findings on the same tooth.
- A procedure from a plan must match the accepted item (same procedure and tooth), and each plan item is carried out once.
- A patient's decision covers every item awaiting a decision; you cannot decide on a closed plan.
- Examinations, periodontal charts, procedures and images are never edited or deleted — only marked entered in error with a reason.
- Supplies are issued first-expiry-first-out, never from expired lots, never below zero; controlled items need a reason and a reference.
- A return can never exceed what the procedure still holds from that lot.

## Troubleshooting / common messages

| Message                                                                                          | Meaning                                                                       | What to do                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Only a dentist can record this                                                                   | Your account is not linked to an active practitioner with profession dentist. | Ask your administrator to link your account.                                                   |
| Your account is not linked to a practitioner who can conduct encounters                          | **Start dental visit** needs a practitioner account.                          | Ask your administrator, or start the visit from the queue with the dentist.                    |
| The encounter is not in progress                                                                 | The visit was signed or ended.                                                | Start a new dental visit.                                                                      |
| Chart at least one tooth or record the examination findings                                      | The examination is empty.                                                     | Chart a tooth, or add notes or oral hygiene.                                                   |
| An FDI tooth code (11–48 permanent, 51–85 primary)                                               | The tooth number is not a valid FDI code.                                     | Type the FDI number, for example 16.                                                           |
| The procedure does not match the planned item (procedure and tooth)                              | The procedure or tooth differs from the plan item chosen.                     | Choose the matching plan item, or record it as **Not from a plan**.                            |
| Only an accepted item of an active plan can be carried out                                       | The plan item is not accepted, or the plan is closed.                         | Record the patient's decision first.                                                           |
| This plan item has already been carried out                                                      | A procedure already completed that item.                                      | Check the procedures list.                                                                     |
| This is the plan's last open item; record the patient's decision or discontinue the plan instead | You tried to cancel the only remaining item.                                  | Record the decision or discontinue the plan.                                                   |
| The plan is closed                                                                               | The plan is completed, declined or discontinued.                              | Propose a new plan.                                                                            |
| … was modified by someone else (expected version …). Reload and try again.                       | Someone changed the plan or setting while you were looking at it.             | Reload the page and repeat.                                                                    |
| Not enough usable … here: … available (expired lots excluded)                                    | The location does not hold enough unexpired stock.                            | Choose another location, lower the quantity, or ask inventory to restock.                      |
| … is a controlled item: every movement needs a reason and a reference                            | A controlled supply was issued or returned without both.                      | Fill in the reason and reference.                                                              |
| This facility has no active stock location. Inventory staff can add one.                         | No storage location exists at this facility.                                  | Ask the inventory officer to add one ([Pharmacy and inventory](09-pharmacy-and-inventory.md)). |
| Only an imaging document (image or DICOM file) can be added                                      | The file type is not accepted.                                                | Upload JPEG, PNG, HEIC, TIFF or DICOM.                                                         |
| The file has not finished uploading                                                              | The stored file is not ready yet.                                             | Wait a moment and click **Add stored file**.                                                   |
| This file is already in the dental record                                                        | The same file was added before.                                               | Nothing to do.                                                                                 |
| A procedure with code … exists                                                                   | Procedure codes are unique.                                                   | Use another code.                                                                              |
| Write the acknowledgement patients confirm before deciding a plan online                         | Online decisions need your clinic's text.                                     | Write at least 20 characters in **What the patient confirms**.                                 |

## Related chapters

- [Appointments and queue](03-appointments-and-queue.md) — booking and checking in dental patients
- [Consultations and care plans](04-consultations-and-care-plans.md) — notes, diagnoses, prescriptions and lab orders for the dental visit
- [Pharmacy and inventory](09-pharmacy-and-inventory.md) — stock locations and items used for dental supplies
- [Billing](10-billing.md) — pricing dental procedures
- [MyHealth patient portal](12-patient-portal.md) — what patients see of their dental record
- [Administration](13-administration.md) — roles and linking users to practitioners
