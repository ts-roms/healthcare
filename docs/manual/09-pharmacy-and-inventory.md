# 9. Pharmacy and inventory

## What this is for

**Pharmacy** (`/pharmacy`) is where you hand over the medicines and supplies on a prescription. Each dispense takes the stock out of inventory at
the same moment, so the stock figures are always right. **Inventory** (`/inventory`) keeps the stock of medicines, medical and dental supplies,
laboratory reagents and consumables, and PPE at each of your facility's storage locations — by lot and expiry — and every movement that changed it.
It also holds **purchase orders** to suppliers.

Stock is always counted per facility. Select your facility in the top bar first; without one these screens ask you to choose it.

## Who uses it

- **Pharmacists** — dispense prescriptions, reverse mistaken dispenses, receive, issue and transfer stock.
- **Nurses** — dispense, and receive, issue and transfer stock.
- **Medical technologists** and **dental assistants** — view stock and record receipts, issues and transfers.
- **Inventory officers** — everything in inventory: movements, counts and write-offs, the catalog, purchase orders.
- **Organization administrators** — everything, including **approving** purchase orders.

| Permission                      | What it allows                                                                              | Default roles                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `prescription.dispense`         | See **Pharmacy**; find and view prescriptions to dispense                                   | pharmacist, nurse, org_admin                                                            |
| `inventory.read`                | See **Inventory**, **Movements** and **Purchase orders**                                    | org_admin, inventory_officer, medical_technologist, nurse, pharmacist, dental_assistant |
| `inventory.move`                | **Receive**, **Issue**, **Transfer**; needed with `prescription.dispense` to dispense       | org_admin, inventory_officer, medical_technologist, nurse, pharmacist, dental_assistant |
| `inventory.adjust`              | **Count** and **Write off**                                                                 | org_admin, inventory_officer                                                            |
| `inventory.catalog.manage`      | **Catalog**: items, suppliers, locations, reorder levels                                    | org_admin, inventory_officer                                                            |
| `inventory.procurement.manage`  | Draft, submit, cancel and close purchase orders; receive deliveries (with `inventory.move`) | org_admin, inventory_officer                                                            |
| `inventory.procurement.approve` | **Approve** purchase orders (never one you submitted)                                       | org_admin                                                                               |

If you don't see a button described below, you are missing the permission in this table — ask your administrator.

## Key ideas

- **Stock unit** — every item is counted in one unit (tablet, vial, box…). All quantities are in that unit.
- **Lots and expiry** — items can be tracked by lot number and expiry date. The printed expiry date is the last usable day.
- **Usable stock** — stock in lots that have not expired. Expired lots are never issued or dispensed; they can only leave through a **Write off**.
- **First expiry, first out (FEFO)** — when you issue, transfer or dispense without choosing a lot, the system takes the lot that expires first.
- **Controlled items** — every movement of a controlled item needs a **reason** and a **reference**. This is the only control the platform applies:
  the official dangerous-drugs register and other regulated records (PDEA, FDA, the Pharmacy Act) are **not** implemented and must be kept as your
  regulations require.
- **The ledger never changes** — movements are never edited or deleted. Mistakes are corrected with a new movement (a count, a write-off, a
  reversal or a return).

---

## Pharmacy

### How to find a prescription to dispense

1. Open **Pharmacy** (`/pharmacy`).
2. Type the **Prescription number** printed on the prescription (for example `RX00000001`; the patient also sees it in MyHealth).
3. Click **Find**. The prescription opens at `/pharmacy/[prescriptionId]`.

If the number is wrong you see "No prescription … in this organization." Always check the patient's identity before handing anything over — the
page header shows the patient's name, patient number, age and sex.

The **Pharmacy** page also lists what was dispensed at this facility today (time, patient, item, quantity; reversed ones marked **Reversed**). "Nothing
dispensed here today." means the list is empty. Click a patient's name to open that prescription.

### How to read the prescription page

- **Prescribed** — each line with the medicine, strength, form, dose and instructions, and under it **Dispensed:** (what has been handed over, or
  "nothing yet") and how much is **left**, refills included.
- A yellow note "Prescribed despite a recorded allergy (decision support overridden by the prescriber)" lists the allergy warnings and the
  prescriber's reason. Read it before dispensing.
- A red note "This prescription is cancelled/superseded … It cannot be dispensed." means it is no longer active. Ask the prescriber for the
  replacement prescription.
- **Dispenses** — every dispense of this prescription, with date, item and quantity.

### How to dispense

1. On the prescription page, go to the **Dispense** panel. (It appears only on an active prescription, and only if you also have `inventory.read`
   and `inventory.move`.)
2. For each line you are handing over now, choose **From stock**: the item and storage location, with the usable quantity. Stock whose name matches
   the prescribed medicine is listed first — this is a name match only; **you** decide what is equivalent. Controlled items are marked
   "controlled". Leave **Not now** for lines you are not dispensing.
3. Enter the **Qty** in the chosen item's stock unit.
4. Optionally add a **Note (optional)**.
5. Click **Dispense N items**. The message is "Dispensed; stock updated".

Only medicines and medical supplies can be dispensed. For controlled items, the stock movement records the prescription number as the reference and
"Dispensed on prescription" as the reason automatically.

When the prescribed unit and the stock unit differ (for example a syrup prescribed in mL and stocked in bottles), the system cannot compare the
amounts. The line then shows "dispensed in another unit: check the amount against the prescription" — use your professional judgement.

If there is no dispensable stock at the facility, the panel shows "No medicines or supplies in stock at this facility."

### How to reverse a mistaken dispense

1. On the prescription page, in **Dispenses**, click **Reverse…** next to the dispense.
2. In **Why is it reversed?**, type the reason (at least 5 characters).
3. Click **Reverse dispense**. The message is "Dispense reversed; stock returned". **Keep** closes the box without reversing.

The same lots go back to the same location. A dispense can be reversed once, and only at the facility where it was made. Reversal works even if the
prescription was cancelled afterwards.

---

## Inventory

### How to check stock

1. Open **Inventory** (`/inventory`). The buttons at the top move between **Stock**, **Movements**, **Purchase orders** and (for catalog managers)
   **Catalog**.
2. Filter with **All**, **Low or out**, or **Expiring (60 days)**, and by **Location**.
3. Each row shows the **Item** (code, and "controlled" where it applies), **Location**, **Usable** quantity (expired quantity underneath),
   **Reorder at**, **Status** and **Lots (earliest expiry first)**.

Status badges: **In stock**, **Low** (usable stock at or below the reorder level), **Out of stock**. Lot badges: **Expiring** (within 60 days) and
**Expired**.

If the facility has no storage locations yet, you see "No storage locations at this facility yet (see Catalog)."

### How to record a stock movement

Use the **Record a movement** panel on the right of `/inventory`. Choose the tab, fill in the fields, and click **Record**. The message is
"Recorded".

**Receive** (stock arriving outside a purchase order)

1. Choose the **Location** and **Item**.
2. For lot-tracked items, enter the **Lot number** (required) and **Expiry** (recommended).
3. Enter the **Quantity**, and optionally the **Supplier** and **Unit cost (₱, optional)**.
4. Add a **Reference** (for example the delivery receipt number) and **Reason** if needed — both required for controlled items.

For goods ordered on a purchase order, use **Receive a delivery** on the order instead (see below).

**Issue** (to a department or purpose)

1. Choose the **Location** and **Item**.
2. Optionally choose a **Lot**; otherwise the earliest expiry is used.
3. Enter the **Quantity** and **Issued to (department or purpose)**, for example "Emergency room" or "Nebulization". Never write a patient's name or
   number here.

**Transfer** (to another location, including another branch)

1. Choose **From** (a location of your facility) and **To** (any active location of the organization).
2. Choose the **Item**, optionally a **Lot**, and the **Quantity**.

**Count** (needs `inventory.adjust`)

1. Choose the **Location**, **Item** and **Lot**.
2. Enter the **Counted quantity** from your physical count and a **Reason**.
3. The difference to the recorded balance is posted. A count equal to the balance is refused — nothing to adjust.

**Write off** (needs `inventory.adjust`)

1. Choose the **Location**, **Item** and **Lot** (expired lots are marked "(expired)").
2. Enter the **Quantity** and a **Reason** (expired, damaged, lost).

Reasons must be at least 3 characters.

### How to review movements

Open **Movements** (`/inventory/movements`). It lists the latest 200 movements at your facility's locations, newest first: when, the kind
(**Received**, **Issued**, **Transferred out**, **Transferred in**, **Count adjustment**, **Written off**, **Returned unused**), item, location,
lot, quantity (+ in, − out), balance after, and details — who it was issued to, the reference, the reason, the unit cost, and the workflow that
moved it: **Pharmacy dispense**, **Loaded on a laboratory instrument**, **Purchase order delivery** or **Dental procedure**.

### How to set up the catalog

Open **Catalog** (`/inventory/catalog`; needs `inventory.catalog.manage`).

**Items**

1. Enter the **Code** (lowercase letters, digits and dashes), **Name**, **Category** (**Medicine**, **Medical supply**, **Reagent**, **Laboratory
   consumable**, **Dental supply**, **PPE**, **Other**) and **Stock unit** (tablet, vial, box…).
2. Tick **Track lot numbers and expiry** (on by default) and, if applicable, **Controlled item**.
3. Click **Add item**.

The stock unit and lot tracking cannot be changed after the item is created, so choose them carefully. The category matters: pharmacy dispenses only
medicines and medical supplies; dental procedures use dental and medical supplies, medicines, PPE and other items; laboratory reagent loads use
reagents.

**Storage locations** — enter a **Code** and **Name** (for example "Pharmacy", "Lab store") and click **Add at** your facility. Locations belong
to the selected facility; locations of other facilities are marked "other facility".

**Suppliers** — enter a **Code**, **Name** and optional **Contact**, then **Add supplier**.

**Reorder levels** — choose the **Location** and **Item**, enter **Reorder at (usable units)** and optionally **Usually order (optional)**, then
**Save**. When usable stock falls to or below the level, the item shows **Low** and appears on the reorder list.

The catalog screen has no button to deactivate an item, supplier or location; ask your administrator if one must be taken out of use.

### How to raise a purchase order

1. Open **Purchase orders** (`/inventory/purchase-orders`). The **To reorder** card lists items at or below their reorder level (stock already on
   open orders counts), with the usual order quantity and the last supplier.
2. In **New purchase order**, choose the **Supplier**, **Deliver to** (a location of your facility) and optionally **Expected by (optional)**. If
   your organization has set up procurement methods, choose the **Procurement method** and, when the method asks for one, enter its reference
   (for example a posting reference). An order without them cannot be submitted.
3. Add items: choose the **Item**, the **Qty** in stock units and, optionally, the **Unit cost** in pesos (for example 12.50). Use **Add item** for
   more lines, or **Fill from reorder list** to fill the lines from the reorder suggestions for that location.
4. Add **Notes (optional)** and click **Save draft**. The order opens with the status **Draft** and a number such as `PO-2026-000001`.
5. On the order, click **Submit for approval**. The status becomes **Awaiting approval**.

The draft cannot be edited on screen after saving. If it is wrong, cancel it (see below) and draft a new one.

### How to approve a purchase order

1. Open the order from **Purchase orders** (the list shows **Open** orders by default; click **All** for finished ones).
2. Check the lines and the **Total** (lines without a price are counted separately).
3. Click **Approve**. The status becomes **Approved**.

You cannot approve an order you submitted yourself — the page says "You submitted this order; someone else approves it."

### How to receive a delivery

1. Open the approved order. (Needs `inventory.procurement.manage` and `inventory.move`.)
2. In **Receive a delivery**, enter the supplier's **Delivery receipt / invoice no.**
3. For each line that arrived, enter the quantity **Arrived** and, for lot-tracked items, the **Lot no.** and **Expiry**.
4. Click **Receive into** (the delivery location). The message is "Delivery received into stock".

The status becomes **Partly received** or **Received**. You cannot receive more than is still outstanding on a line. Repeat for later deliveries.

### How to cancel or close a purchase order

- **Cancel order** — for a draft, submitted or approved order with nothing received yet. Under **Withdraw the order**, type a **Reason** (at least
  5 characters) and click **Cancel order**.
- **Close short** — for an approved or partly received order when no more will arrive. Under **No more deliveries?**, type a **Reason** and click
  **Close short**.

The history card on the order shows when it was drafted, submitted, approved and cancelled or closed.

Purchase orders here are your internal ordering record. Public procurement rules (RA 9184, PhilGEPS) are **not** built in: the procurement
methods and the references they ask for are your organization's own settings.

### How to set up withholding codes and procurement methods

Open **Tax and procurement** (`/inventory/compliance`). You need `inventory.procurement.approve` to change them.

- **Withholding codes** — add each code your accountant uses, with a description and, if you like, its rate as a reminder. The platform never
  calculates withholding; the rate is only shown when paying.
- **Procurement methods** — add each method your procurement rules name. Fill **Reference asked for** (for example "Posting reference") when
  orders under that method need one. Once any method is in use, every purchase order must name one before it is submitted.
- **Stop using** retires a code or method; orders and payments that used it keep it.

Have your accountant and procurement officer check these settings, then record the review under **Admin → Compliance**.

### How to record a supplier payment with withholding

On an approved supplier invoice, in **Record the payment**, enter **Paid on** and the check or transfer reference. If tax was withheld, choose
the **Withholding code**, enter the **Amount withheld** in pesos (as your accountant determined it) and, optionally, the certificate reference.
The card shows what is paid to the supplier. Click **Mark paid**. The invoice then shows the amount withheld and the amount paid; a paid invoice
cannot be changed.

### How to read the controlled register

Open **Controlled register** (`/inventory/controlled-register`; pharmacists, inventory officers and administrators).

1. Choose the period (**From**, **To**) and click **Show**. For each controlled item and location you see the balance before the period, every
   movement (received, issued or dispensed, transferred, counted, written off, returned) with the lot, reference, recipient, reason and who
   recorded it, the running balance, and the balance at the end.
2. Click **Download CSV** for the same register as a spreadsheet. Viewing and downloading are recorded.
3. Under **Register details**, inventory administrators record the facility's licence reference and the responsible person, as issued. The
   platform does not verify them.

This is the platform's own layout of the stock ledger. Confirm with your pharmacist or adviser that it serves as the register the regulator
requires, and record the review under **Admin → Compliance**.

### Stock used by other modules

- **Laboratory** — loading a reagent lot on an instrument can take it from stock. After that, the tests run on the lot are counted on the
  laboratory's **Reagent use** page (runs never move stock again), which also shows the stock cost per patient run once the lot is unloaded (see
  [How to follow reagent use per test run](07-laboratory-quality.md#how-to-follow-reagent-use-per-test-run)).
- **Dental** — the supplies a procedure used are issued from stock and unused ones returned (see [Dental](08-dental.md)).
- **Pharmacy** — every dispense and reversal, as above.

These movements follow the same rules as yours and appear on **Movements** with their source.

## Rules the system enforces

- The location must belong to your selected facility and be active; the item must be active.
- Stock can never go below zero; a movement that would do so is refused.
- Expired lots are never issued, transferred or dispensed — only written off.
- Lot-tracked items need a lot number when received.
- Controlled items need a reason and a reference on every movement.
- Only active prescriptions are dispensed, and never more than prescribed (quantity × (1 + refills)) when the stock unit is the prescribed unit.
- Pharmacy dispenses only medicines and medical supplies; each module takes only the item categories it is allowed.
- A dispense is reversed once, with a reason, at the facility where it was made.
- A purchase order's approver is never its submitter. Deliveries never exceed the ordered quantity. An order with goods received cannot be
  cancelled — close it short instead.
- Retrying the same submission (for example after a network error) does not record the movement twice.

## Troubleshooting / common messages

| Message                                                                                                     | Meaning                                                                          | What to do                                                                        |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| No prescription … in this organization.                                                                     | The number was not found.                                                        | Check the number on the prescription (`RX` followed by 8 digits).                 |
| Prescription … is cancelled / superseded; it cannot be dispensed                                            | The prescription is no longer active.                                            | Ask the prescriber for the current prescription.                                  |
| Line N (…): … left to dispense on this prescription                                                         | You entered more than remains on the prescription.                               | Lower the quantity.                                                               |
| This dispense was already reversed                                                                          | Someone reversed it before you.                                                  | Refresh the page.                                                                 |
| This dispense was made at another facility                                                                  | Reversals happen where the dispense was made.                                    | Select that facility, or ask staff there.                                         |
| Not enough usable … here: … available (expired lots excluded)                                               | The location lacks enough unexpired stock.                                       | Choose another location or lot, lower the quantity, or restock.                   |
| Not enough stock in this lot (… on hand)                                                                    | The chosen lot holds less than you asked for.                                    | Choose another lot or leave the lot empty (earliest expiry first).                |
| Lot … expired on …; write it off instead                                                                    | You chose an expired lot for an issue or transfer.                               | Use another lot; write the expired one off.                                       |
| … is a controlled item: every movement needs a reason and a reference                                       | Reason or reference is missing.                                                  | Fill in both.                                                                     |
| … is tracked by lot: give the lot number (and expiry)                                                       | A lot-tracked item was received without a lot number.                            | Enter the lot number and expiry.                                                  |
| The count matches the recorded balance; nothing to adjust                                                   | Your count equals the balance.                                                   | Nothing to do.                                                                    |
| … is not an item this workflow takes from stock                                                             | The item's category is not allowed here (for example a reagent at the pharmacy). | Choose a proper item, or ask the catalog manager to check the category.           |
| The location belongs to another facility                                                                    | The location is not at your selected facility.                                   | Select the right facility in the top bar.                                         |
| An item with code … exists / A supplier with code … exists / A location with code … exists at this facility | Codes are unique.                                                                | Use another code.                                                                 |
| You submitted this purchase order; someone else approves it                                                 | Separation of duties.                                                            | Ask another approver.                                                             |
| Line N: only … still expected on this order                                                                 | The delivery is more than is outstanding.                                        | Receive only the outstanding quantity; record extra goods separately if accepted. |
| Goods have arrived on this order; close it instead                                                          | You tried to cancel a partly received order.                                     | Use **Close short**.                                                              |
| Purchase order … is …; it cannot be …                                                                       | The order's status does not allow that action.                                   | Refresh the page to see its current status.                                       |
| … was modified by someone else (expected version …). Reload and try again.                                  | Someone changed the order while you had it open.                                 | Reload and repeat.                                                                |

## Related chapters

- [Getting started](01-getting-started.md) — selecting your facility
- [Consultations and care plans](04-consultations-and-care-plans.md) — how prescriptions are written
- [Laboratory quality](07-laboratory-quality.md) — reagent lots on instruments
- [Dental](08-dental.md) — supplies used by dental procedures
- [MyHealth patient portal](12-patient-portal.md) — where patients see their prescription numbers
- [Administration](13-administration.md) — roles and permissions
