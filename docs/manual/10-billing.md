# 10. Billing

**What this is for.** Billing turns the care a patient received into charges, invoices, payments and receipts. Charges are captured
automatically from consultations, laboratory orders and dental procedures (when the service is set up to do so), or added by staff. You gather a
patient's charges into a draft invoice, apply discounts and HMO or PhilHealth coverage, issue it, and take payment. Corrections after issue are made
with credit notes, debit notes or a void — never by editing an issued invoice. Billing also keeps each patient's deposit and credit balance, sells
packages, and gives you a daily report.

**Who uses it.** Cashiers (day-to-day billing), clinic managers and organization administrators (refunds, voids, credit and debit notes, prices
and settings). Receptionists can look at charges and invoices but cannot change them.

Billing is kept **per facility**. Select your facility in the top bar first; otherwise billing screens show "Select your facility in the top bar
first."

All amounts are in Philippine pesos (₱). The system computes every total; you only type amounts such as `500.00` or `1,234.50`.

## Where to find it

| Screen                          | Path                     | What you do there                                                                          |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Cashier's desk                  | `/billing`               | See who has charges **To invoice**, **Drafts in progress** and **Balances owed**           |
| Patient billing                 | `/billing/patients/[id]` | Charges to invoice, add or cancel a charge, invoices, packages, deposit and credit balance |
| Invoices                        | `/billing/invoices`      | Invoices by day, drafts, balance owed, issued, void                                        |
| Invoice workspace               | `/billing/invoices/[id]` | Lines, discounts, coverage, issue, payments, refunds, notes, void, PhilHealth claim        |
| Daily report                    | `/billing/reports`       | End-of-day figures                                                                         |
| Prices and discounts (settings) | `/billing/settings`      | Services and prices, packages, discount rules, payers, tax and document settings           |

The buttons **Invoices**, **Daily report** and **Prices and discounts** appear at the top of every billing screen (the last two only if you have
the permission). You can also open a patient's billing from the patient record with the **Billing** button.

## How to see what needs billing today

1. Open **Billing** (`/billing`).
2. **To invoice** lists patients with pending charges: number of charges, amount, and the date of the oldest one. Click a patient's name to open
   their billing page.
3. **Drafts in progress** lists invoices started but not yet issued. **Balances owed** lists issued invoices the patient has not fully paid.
   Click any row to open the invoice.

If the lists are empty you see "No charges waiting to be invoiced.", "No drafts." or "Nothing owed on issued invoices."

## How to add a charge by hand

Use this for anything not captured automatically (for example a service whose visit type or test is not linked to a billable service).

1. Open the patient's billing page (`/billing/patients/[id]`).
2. Under **Charges to invoice**, click **Add a charge**.
3. Choose the **Service**. The list shows each service's current price, or "no price set".
4. Enter **Qty**. The **Unit price (₱)** is filled with the listed price.
5. If you change the price, a field **Reason for a different price** appears. The reason is required and recorded with both prices.
6. Click **Add charge**.

If you don't see **Add a charge**, you need the `billing.charge.capture` permission — ask your administrator. Cashiers have it by default.

Packages are not added here; see [How to sell a package](#how-to-sell-a-package).

## How to cancel a charge that was not invoiced

1. On the patient's billing page, click the **×** next to the charge.
2. Type a **Reason** (at least 3 characters) and click **Cancel charge**. Click **Keep** to leave it.

A charge already on an invoice cannot be cancelled here. Remove it from the draft first, or correct an issued invoice with a credit note or void.

## How to prepare an invoice

1. On the patient's billing page, all pending charges are ticked. Untick any you do not want on this invoice.
2. Click **Prepare invoice (n)**. The total of the ticked charges is shown beside the button.
3. The draft opens in the invoice workspace (`/billing/invoices/[id]`).

In the draft you can:

- **Remove a line** with the **×** at the end of the row. The charge goes back to pending ("Line removed; the charge is pending again").
- **Apply discounts** and **add payer coverage** (below).
- **Print draft** — the PDF is marked as a draft.
- **Discard draft** — all its charges return to pending.

If you don't see **Prepare invoice**, you need the `billing.invoice.issue` permission.

## How to apply a discount (Senior Citizen, PWD and others)

Discount rules are set up by your administrator under **Prices and discounts**. Nothing is preset.

1. In a draft invoice, find the **Discounts** card.
2. Under **Apply a discount**, choose the rule. The list shows its rate and which categories it covers.
3. If the rule needs proof, enter the **ID number** (for example the OSCA or PWD ID number). You can add a note such as "ID seen, photocopy on
   file".
4. Click **Apply**.

The discount is computed on each line of the categories it covers. The ID number is stored and afterwards shown masked (for example `ID •••• 4512`).
To take a discount off, click the **×** beside it.

If you don't see the **Discounts** card on a draft, you need the `billing.discount.apply` permission. Cashiers have it by default.

## How to add HMO, PhilHealth or other payer coverage

1. In a draft invoice, find **HMO, PhilHealth and other payers**. "The patient pays everything." means no coverage yet.
2. Under **Add coverage**, choose the payer, enter the amount it covers, and the **LOA / reference** (for example the HMO letter of authorization
   number).
3. Click **Set coverage**.

The patient's share is the net total less all coverage. You enter the covered amount yourself: the system does not calculate HMO benefits,
PhilHealth case rates or eligibility. Payers are set up under **Prices and discounts**.

## How to issue an invoice

1. Check the lines, discounts, coverage and totals in the summary card (**Gross**, **Discounts**, **Net**, **Covered by payers**, **Patient's share**).
2. Click **Issue invoice**.

Issuing gives the invoice its number (for example `INV-2026-000001`) and records the organization's tax details and, if the organization is
VAT-registered, a **VAT breakdown**. After that the invoice cannot be changed — only paid, credited, debited or voided. Click **Print invoice** for
the PDF.

## How to record a payment

1. Open the issued invoice. The **Payments** card shows the current **Balance**.
2. The amount is filled with the balance. Change it for a partial payment.
3. Choose the method: **Cash**, **Card**, **E-wallet**, **Bank transfer**, **Check** or **Other**.
4. Enter a **Reference** if there is one (card slip, e-wallet transaction number).
5. Click **Record payment**.

Each payment gets a receipt number (for example `AR-2026-000001`). Click the receipt number to print the acknowledgement receipt. You cannot record
more than the balance; give change at the counter. If the connection drops and you click again, the payment is recorded only once.

If you don't see the payment form, you need `billing.payment.record` (cashiers have it).

> Receipt numbers are the clinic's acknowledgement receipts. Whether they can serve as BIR official receipts must be confirmed with your accountant
> before production use.

## How to refund a payment

1. In the **Payments** table, click **Refund…** on the payment.
2. The amount is filled with what is left to refund. Enter a **Reason** (at least 3 characters).
3. Click **Refund**.

The refund uses the payment's method and is recorded with your name and the reason. A fully refunded payment shows "Refunded".

If you don't see **Refund…**, you need `billing.refund.issue`. By default only organization administrators have it.

## How to follow up an HMO or PhilHealth claim

After issue, each coverage line shows its status: **Pending**, **Submitted**, **Settled** or **Denied**.

1. When you have sent the claim to the payer, click **Submitted**.
2. When the payer pays, click **Settled…**, enter the amount settled, and click **Settled**.
3. If the payer refuses, click **Denied**.

These buttons record what happened with the payer; the system does not contact the payer. They need `billing.invoice.issue`.

## How to prepare a PhilHealth claim

On an issued invoice with a PhilHealth coverage line, the **PhilHealth claim** panel shows what the claim needs from the clinic's own records:

- The invoice is issued
- The invoice has a PhilHealth coverage line
- The patient's PhilHealth identification number is recorded
- The facility's PhilHealth accreditation number is recorded
- The recorded accreditation covers the dates of service (when validity dates were entered)
- A billed encounter has an ICD-10 coded diagnosis

Missing items are marked "— missing". The panel also shows the latest PhilHealth eligibility answer recorded for the dates of service, for
information only (see [Patients](02-patients.md)).

**PhilHealth eClaims is not connected.** The official PhilHealth specification has not been obtained, so nothing is sent from the platform. File the
claim through PhilHealth's own channel, then mark the coverage line **Submitted** (and later **Settled** or **Denied**). The **Submit to PhilHealth**
button only appears once an eClaims adapter is configured.

You see the panel only with the `philhealth.claim.submit` permission (cashiers and organization administrators have it). The facility's
accreditation number is recorded under **Prices and discounts** (see [Settings](#how-to-set-up-prices-discounts-and-payers)).

## How to apply a deposit or credit balance to an invoice

1. Open the issued invoice that still has a balance. The **Deposit and credit** card shows the **Patient's balance**.
2. Enter the amount under **Apply (₱, up to …)** — at most the invoice balance or the patient's usable balance, whichever is smaller.
3. Click **Apply deposit**.

If you don't see the card, you need `billing.deposit.record` (cashiers have it).

## How to record a deposit (advance payment)

1. Open the patient's billing page. The **Deposit and credit** card shows the balance at this facility and its history.
2. Click **Record a deposit**.
3. Enter **Amount (₱)**, **Method** and **Reference** (optional).
4. Click **Record deposit**.

The deposit gets a receipt number; click it in the history to print the receipt. Later, apply the balance from the invoice (above).

## How to refund a deposit or credit balance

1. On the patient's billing page, in **Deposit and credit**, click **Refund balance…**.
2. Enter the amount (up to the usable balance), **Method** and **Reason**.
3. Click **Refund**.

This needs `billing.refund.issue`.

The history lists each entry: **Deposit**, **Credit note**, **Applied to invoice**, **Returned from voided invoice**, **Refunded**, **Moved in from
another facility**, **Moved to another facility**.

If your organization allows deposits to be used at any of its facilities, the card also shows **Usable at any facility** with each facility's
balance. When you apply or refund more than this facility holds, the difference is moved here from the other facilities automatically.

## How to sell a package

Packages are set up under **Prices and discounts** (a price plus a fixed list of included services).

1. On the patient's billing page, in **Packages**, choose the package in **Sell a package…**.
2. Click **Sell**. The package price is added to the charges to invoice.
3. Invoice and collect it like any other charge.

While the package is active and within its dates, included services charged at this facility are covered: they appear at ₱0, described as
"(covered by …)", until the included quantity is used up. Each package shows "n of m left" per service.

To cancel a package that was never used, click **Cancel unused package…**, give a **Reason**, and click **Cancel package**. If the package sale was
already invoiced, cancelling does not refund it — issue a credit note on that invoice. A package that was used cannot be cancelled.

Selling and cancelling need `billing.charge.capture`.

## How to issue a credit note

Use a credit note to reduce an issued invoice without voiding it (for example a line charged in error or a price reduced after issue).

1. Open the issued invoice. In **Credit notes**, click **Issue credit note…**.
2. For each line to credit, enter an amount (each shows "Up to …", what is left of it). Lines of debit notes are listed too.
3. If part of the credit should come off a payer's open claim, enter it under **Of this, off a payer's open claim (the rest is the patient's)**.
   Payers appear here only while their claim is Pending or Submitted.
4. Enter a **Reason** and click **Issue credit note**.

The credit note is numbered (for example `CN-2026-000001`), cannot be changed, and can be printed. The patient's part first reduces what they
still owe; anything they had already paid goes to their deposit and credit balance. A payer's part reduces its open claim.

This needs `billing.credit-note.issue` (organization administrators by default).

## How to issue a debit note

Use a debit note to add to an issued invoice (for example a service that was left off).

1. Open the issued invoice. In **Debit notes**, click **Issue debit note…**.
2. For each line, choose a service (at its listed price, or type another **Unit price**), or choose **An adjustment (describe it)** and describe
   it. Enter the quantity. Click **Line** to add more lines.
3. Enter a **Reason**. The total is shown as "Adds ₱…".
4. Click **Issue debit note**.

The debit note is numbered (for example `DN-2026-000001`) and adds to the patient's balance. A mistaken debit note is corrected with a credit note on
its lines. This needs `billing.debit-note.issue` (organization administrators by default).

## How to void and reissue an invoice

1. Refund any payments on the invoice first.
2. In the summary card, click **Void…**.
3. Enter the **Reason for voiding**.
4. Leave **Put the charges on a new draft to correct and reissue** ticked to get a new draft with the same charges, discounts (with their evidence)
   and coverage. Untick it if the charges should not be billed again.
5. Click **Void invoice**. With reissue, the new draft opens.

A voided invoice shows "Void: [reason]" with a link to its **replacement**. Any deposit applied to it returns to the patient's balance.

This needs `billing.invoice.void` (organization administrators by default). If a credit or debit note was already issued, **Void…** is not shown:
correct the invoice with another credit or debit note instead.

## How to find invoices

1. Open **Invoices** (`/billing/invoices`).
2. Use the filters: **All** (one day, today by default), **Drafts**, **Balance owed**, **Issued**, **Void**.
3. To see another day, pick a date and click **Show day**.

The table shows each invoice's state (**Draft**, **Unpaid**, **Partly paid**, **Paid**, **Void** — with text and icon), net total, payers' share
and balance.

## How to see online payments

Patients can pay issued invoices online in MyHealth **only once a payment provider is configured** — none is by default, so patients see no pay
button and pay at the clinic. When online payments exist, the invoice shows an **Online payments** card with each attempt and its status
(**Waiting for the provider**, **Paid**, **Failed**, **Cancelled**, **Expired**). A successful online payment appears in **Payments** with its own
receipt number; if the invoice was paid at the counter in the meantime, the extra amount goes to the patient's deposit balance.

## How to read the daily report

1. Open **Daily report** (`/billing/reports`). Use the arrows or **Today** to change the day.
2. The report shows, for the selected facility and day:
   - **Invoices issued** — issued, voided, gross, discounts, net, payers' and patients' shares.
   - **Collections** — by method, refunds, **Net collected**.
   - **Still owed (all dates)** — by patients, invoices with a balance, by payers not yet settled, deposits and credit held.
   - **Deposits** — received by method, applied, refunded.
   - **Debit notes issued**, **Credit notes issued**, **Discounts given**.

This needs `billing.report.read` (cashiers have it).

## How to set up prices, discounts and payers

Open **Prices and discounts** (`/billing/settings`). The button appears only if you have `billing.pricelist.manage` (organization administrators by
default), which you need to change anything. Other billing staff can open `/billing/settings` directly to view the settings.

**Services and prices**

1. Under **Add a service**, enter a **Code**, the **Name on the invoice** and the **Category** (Consultation, Procedure, Laboratory, Dental,
   Telemedicine, Supply, Other).
2. Choose when it is charged: **Only when added by staff**, **When a visit of a type is signed**, **When a laboratory test is ordered**, or **When a
   dental procedure is performed** — then choose the visit type, test or procedure. For a dental procedure also choose **Price per procedure** or
   **Price per surface treated** (for example a composite restoration priced per surface: a filling on three surfaces is charged three times).
3. Enter the **Price** and the date it applies from. Click **Add service**.

A dental service's **Price per procedure / Price per surface treated** can be changed later in the **Charged on** column; the change applies to
procedures recorded afterwards. Dental fee estimates follow the same rule.

To change a price, click **New price** on the service, enter the amount and the **Effective from** date, and click **Save**. The old price ends the
day before. Charges and invoices already made keep the price they used. Use **Deactivate** / **Activate** to stop or resume using a service.

"No services yet. Nothing is charged automatically until you add them." — automatic charging only works for services linked to a visit type, test
or dental procedure. Anything else is added by staff.

**Packages** — click **New package**, enter code, name, category, price, optionally **Usable for days**, VAT class, and the included services and
quantities (click **Service** for another row). Click **Create package**. Contents cannot be changed later; create a new package instead.

**Discount rules** — under **Add a discount rule**, enter code, name, **Kind** (Senior citizen, Person with disability, Employee, Promotional,
Other), **Rate (%)**, the date it applies from, and which categories it applies to (none ticked = everything). Tick **Statutory (ID number
required)** and/or **Combines with other discounts** as your policy says (rules of the kind Senior citizen or Person with disability always require
the ID number). Click **Add rule**. A rule cannot be edited: **Deactivate** it and add a
new one.

> Statutory discounts (Senior Citizen — RA 9994; PWD — RA 10754): confirm the rate, covered services, VAT treatment and whether discounts combine
> against current official issuances before use. Nothing is preset.

**Payers** — enter a code, type (**HMO**, **PhilHealth**, **Insurance**, **Company**, **Other**) and name, and click **Add payer**. Use the type
**PhilHealth** for PhilHealth coverage so the PhilHealth claim panel appears on invoices.

**Tax and documents** — enter the **Registered name**, **TIN (as registered)**, **Registered address**, **VAT status** (Not configured,
VAT-registered, Non-VAT), **VAT rate (%)**, **Permit reference** and **Text printed on invoices**, as your BIR registration and your accountant say.
Tick **Patients' deposits and credit can be used at any of our facilities** if your organization allows it. When VAT-registered, every service
invoiced needs a **VAT class** (VATable, VAT-exempt, Zero-rated), set in the service list; services without one show "Needed to issue invoices".

**Document numbers** — set the **Prefix** of each series (Invoices, Receipts, Credit notes, Debit notes) and, if you have an authorized range, the
**Last number**. Leave it blank for "No limit". When the last authorized number is reached, nothing more is issued in that series until you enter the
next range.

**PhilHealth accreditation** and **PhilHealth YAKAP participation** (only for the selected facility, with `philhealth.settings.manage`) — record the
number or reference PhilHealth issued, with validity dates, and click **Save**. These are recorded as written; they are not verified with
PhilHealth.

> The platform does not know BIR rules. Invoice and receipt format and wording, VAT treatment (including of statutory discounts), and whether
> acknowledgement receipts, credit notes and debit notes meet BIR requirements must be confirmed with your accountant before production use.

## Rules the system enforces

- Charges, invoices, payments and reports belong to one facility; you must select it first.
- An issued invoice cannot be edited. Correct it with a credit note, a debit note, or void and reissue.
- An invoice needs at least one line to be issued.
- Payer coverage cannot exceed the invoice total after discounts.
- A discount that needs proof cannot be applied without the ID number. A discount rule that does not combine cannot be added next to another one
  (and vice versa).
- A different price on a manual charge needs a reason.
- Payments are only recorded on issued invoices and never more than the balance. Refunds never exceed what is left of the payment.
- Refunds (of payments or of deposit balance) need `billing.refund.issue` and a reason.
- A void needs a reason and is refused while payments remain (refund first), after a payer has settled, or once a credit or debit note exists.
- A settled amount cannot be more than the coverage on the invoice.
- A deposit application cannot exceed the invoice balance or the patient's usable balance. A facility's deposit balance never goes below zero.
- Credit notes cannot credit a line for more than is left of it; a payer's part is only allowed while its claim is Pending or Submitted.
- When the organization is VAT-registered, an invoice is not issued until every service on it has a VAT class.
- When a number series reaches its last authorized number, nothing more is issued in it (no number is used up).
- A used package cannot be cancelled; package contents never change.
- Online payment is refused until a payment provider is configured. PhilHealth eClaims submission is refused until an adapter is configured.

## Troubleshooting / common messages

| Message                                                                                                         | Meaning                                                             | What to do                                                               |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Select your facility in the top bar first.                                                                      | Billing is per facility                                             | Choose your facility in the top bar                                      |
| The patient has no charges to invoice at this facility                                                          | Nothing pending for this patient here                               | Add a charge, or check you selected the right facility                   |
| Some charges are not pending for this patient at this facility                                                  | Another cashier invoiced or cancelled them meanwhile                | Reload the page                                                          |
| Changing the listed price needs a reason                                                                        | You typed a different price                                         | Enter the reason                                                         |
| This service has no price for the date; enter one                                                               | The service has no price in effect                                  | Type a unit price, or ask an administrator to add a price                |
| Packages are sold from the patient's packages, not added as a charge                                            | You tried to add a package as a charge                              | Use **Sell a package…**                                                  |
| [Rule] needs the ID number that proves eligibility                                                              | The discount requires evidence                                      | Enter the OSCA/PWD or other ID number                                    |
| This discount cannot be combined with the one already applied                                                   | One of the discounts does not combine                               | Remove the other discount, or apply only one                             |
| This discount is not in effect                                                                                  | The rule's dates do not cover today                                 | Ask an administrator to check the rule                                   |
| Payer coverage is more than the invoice total after discounts                                                   | Coverage too high                                                   | Lower the covered amount                                                 |
| The organization is VAT-registered: classify these services for VAT in billing settings before issuing          | A service has no VAT class                                          | Ask an administrator to set the VAT class under **Prices and discounts** |
| The organization is VAT-registered but has no VAT rate configured                                               | Tax profile incomplete                                              | Enter the VAT rate under **Tax and documents**                           |
| The invoice number series is used up; configure the next authorized range                                       | The last authorized number was reached (also receipt, credit note…) | Enter the next authorized range under **Document numbers**               |
| The payment is more than the balance                                                                            | Amount above what is owed                                           | Enter the balance and give change                                        |
| The refund is more than what is left of the payment                                                             | Part was already refunded                                           | Refund at most the remaining amount                                      |
| The refund is more than the patient's deposit and credit balance                                                | Balance too low                                                     | Refund at most the usable balance                                        |
| The amount is more than the invoice balance / … the patient's deposit and credit balance                        | Deposit application too high                                        | Lower the amount                                                         |
| Refund the payments before voiding this invoice                                                                 | Payments remain on the invoice                                      | Refund them, then void                                                   |
| A payer has already settled this invoice                                                                        | Cannot void after a payer paid                                      | Correct with a credit or debit note                                      |
| A credit note was issued for this invoice; correct it with another credit note                                  | Void not allowed after a note                                       | Issue another credit (or debit) note                                     |
| The settled amount is more than the coverage on the invoice                                                     | Settled figure too high                                             | Enter the amount actually settled                                        |
| Only coverage that is pending or submitted can be credited; a settled or denied claim is a matter for the payer | You tried to credit a closed claim                                  | Put the whole credit on the patient's part                               |
| A line credits more than is left of the invoice line                                                            | Credit too high for that line                                       | Enter at most the "Up to" amount                                         |
| The package was already used; it can no longer be cancelled                                                     | Some included service was used                                      | Keep the package; issue a credit note if a refund is agreed              |
| PhilHealth eClaims is not connected: … Submit through PhilHealth's own channel and record the claim reference … | No eClaims adapter                                                  | File through PhilHealth's channel; mark the coverage **Submitted**       |
| … was modified by someone else … Reload and try again.                                                          | Someone else changed the invoice or record while you were working   | Reload the page and repeat your change                                   |

## Related chapters

- [Getting started](01-getting-started.md) — facility selection, permissions
- [Patients](02-patients.md) — PhilHealth number, eligibility answers, YAKAP registration
- [Consultations and care plans](04-consultations-and-care-plans.md) — signed consultations create charges
- [Laboratory](06-laboratory.md) — lab orders create charges
- [Dental](08-dental.md) — dental procedures create charges
- [Records, reporting and integrations](11-records-reporting-and-integrations.md) — PhilHealth submissions and integration review
- [Patient portal](12-patient-portal.md) — what patients see under Bills
- [Administration](13-administration.md) — roles and permissions
