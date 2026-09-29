# 6. Laboratory

## What this is for

The laboratory module takes a test from the doctor's order to a released result. You collect and label the specimen, receive it in the laboratory,
enter the result, and sign it off in three steps: verify, approve, release. Only released results reach the ordering doctor, the patient record and,
where allowed, the patient's MyHealth. The module also handles critical results, corrections, file attachments, the test catalog and tests you send to
outside (reference) laboratories.

## Who uses it

| Role                       | Typical work                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Phlebotomist, nurse        | Collect specimens and print tube labels                                                       |
| Medical technologist       | Collect, receive, reject, enter and verify results, document critical-result calls, send-outs |
| Pathologist                | Verify, approve, release and correct results; manage the catalog and the facility policy      |
| Physician                  | Orders tests from the consultation, reads released results, acknowledges critical results     |
| Records officer            | Reads orders and released results                                                             |
| Organization administrator | Everything above                                                                              |

Default permissions by role:

| Permission             | Physician | Nurse | Records officer | Medical technologist | Pathologist | Phlebotomist |
| ---------------------- | :-------: | :---: | :-------------: | :------------------: | :---------: | :----------: |
| `lab.order.read`       |     ✓     |   ✓   |        ✓        |          ✓           |      ✓      |      ✓       |
| `lab.order.create`     |     ✓     |       |                 |          ✓           |             |              |
| `lab.order.cancel`     |     ✓     |       |                 |                      |             |              |
| `lab.specimen.collect` |           |   ✓   |                 |          ✓           |             |      ✓       |
| `lab.specimen.receive` |           |       |                 |          ✓           |             |              |
| `lab.specimen.reject`  |           |       |                 |          ✓           |             |              |
| `lab.result.read`      |     ✓     |   ✓   |        ✓        |          ✓           |      ✓      |              |
| `lab.result.enter`     |           |       |                 |          ✓           |             |              |
| `lab.result.verify`    |           |       |                 |          ✓           |      ✓      |              |
| `lab.result.approve`   |           |       |                 |                      |      ✓      |              |
| `lab.result.release`   |           |       |                 |                      |      ✓      |              |
| `lab.result.amend`     |           |       |                 |                      |      ✓      |              |
| `lab.critical.manage`  |           |       |                 |          ✓           |      ✓      |              |
| `lab.catalog.manage`   |           |       |                 |                      |      ✓      |              |
| `lab.dashboard.read`   |           |       |                 |          ✓           |      ✓      |              |

Organization administrators hold all of these. Your administrator may have set up roles differently.

You see **Laboratory** in the side navigation if you have `lab.order.read`. Its pages are **Workbench** (`/laboratory/worklist`), **Send-outs**
(`/laboratory/send-outs`), **Critical results** (`/laboratory/critical`) and **Catalog** (`/laboratory/catalog`). The quality pages (**Quality
control**, **Instruments**, **Reagent use**, **Temperatures**, **Nonconformances**, **Proficiency testing**, **Competency**) are covered in
[Chapter 7](07-laboratory-quality.md).

Most laboratory pages work on the facility selected in the top bar. If no facility is selected, the page asks you to choose one first.

## Where orders come from

Doctors order tests from the consultation (encounter) workspace, while the consultation is open. See
[Chapter 4](04-consultations-and-care-plans.md). The order gets a number like `LO00000123`. Each test in the order appears on the **Collect**
worklist of the facility where it was ordered. Billing picks up the ordered tests as charges automatically (see [Chapter 10](10-billing.md)).

The workbench shows who requested the test (**Requested by …**), marked **(external)** or **(patient request)** when the order did not come from a
consultation. It also shows the clinical indication, notes, **STAT** and **Fasting** badges.

## How to use the workbench

1. Open **Laboratory → Workbench** (`/laboratory/worklist`). The title shows **Laboratory · _your facility_**.
2. Choose a stage at the top: **Collect**, **Receive**, **Enter results**, **Verify**, **Approve** or **Release**. The number next to each stage is
   how many items are waiting. The page opens on the first stage you are allowed to work on.
3. Optional: pick a section in the **All departments** list to narrow the list.
4. Click a row. The right-hand panel shows the patient, the order and every action you can take now.

STAT orders are listed first and carry a red **STAT** badge. The status line at the top shows how many STAT items are open, how many are **past
turnaround**, send-outs waiting, and a red link when critical results are unacknowledged.

The workbench updates by itself when colleagues collect, receive or sign off work. The indicator at the top shows whether live updates are
connected. If the live connection is down, the page still refreshes every 15 seconds.

If a stage is empty you see "Nothing waiting at this stage."

### Scan a specimen barcode

1. Press **F2** (or click the **Scan accession** box).
2. Scan the tube label, or type the accession number and press Enter.
3. The specimen opens in the right-hand panel, with all actions that apply to it, whatever stage you are on.

Accession numbers are digits only. If the number is not found you see "No specimen _number_ at _facility_."

## How to collect a specimen

You need `lab.specimen.collect`.

1. Go to the **Collect** stage and click the order.
2. Under **Collect**, the tests are grouped by specimen type (one tube per group). Untick any test you are not collecting now.
3. Click **Collect _specimen type_** (for example **Collect serum**).
4. The system assigns an accession number and shows "Collected. Label the tube: _number_". Click **Print label** in that message, or **Print tube
   label** in the panel later.
5. Stick the label on the tube.

Collection time is recorded as now, with your name. Tests you left unticked stay on the **Collect** worklist.

### Print or reprint a tube label

Click **Print tube label** on the specimen (you need `lab.specimen.collect`). The label opens as a PDF sized for 2.25 × 1.25 inch label stock. It
carries a Code 128 barcode of the accession number and only what the bench needs: patient name and number, sex/age, specimen type, STAT, collection
time and test codes. No birth date, address or results are printed. Rejected specimens cannot be labelled. Every print is recorded in the audit
trail.

## How to receive a specimen

You need `lab.specimen.receive`.

1. Go to the **Receive** stage (or scan the tube).
2. Click the specimen, then **Receive specimen**.

Results can only be entered after the specimen is received. If a test is set up to be sent to a reference laboratory, receiving the specimen also
prepares the send-out (see [Send-outs](#how-to-send-tests-to-a-reference-laboratory)).

## How to reject a specimen

You need `lab.specimen.reject`.

1. Open the specimen and click **Reject specimen…**.
2. Enter **Why is the specimen rejected?** (for example "Haemolysed, clotted, unlabelled").
3. Leave **Request recollection** ticked to send the tests back to the **Collect** worklist. Untick it to cancel the tests instead.
4. Click **Reject**. Click **Keep** to go back without rejecting.

Rejecting cancels any unreleased results on the specimen. You cannot reject a specimen whose results were already released — correct the results
instead.

## How to enter results

You need `lab.result.enter`.

1. Go to **Enter results** and open the specimen (or scan it).
2. Under **Enter results**, choose the **Instrument** the tests ran on, or **Manual / not on a registered instrument**. The list appears only when
   your facility has instruments registered and you can read QC (see [Chapter 7](07-laboratory-quality.md)).
3. Type each value:
   - Numeric tests: a number, with a dot for decimals. The unit is shown next to the box.
   - Coded tests: pick a value from the list (for example Reactive / Nonreactive).
   - Text tests: type the text.
4. Add a **Comment (optional)** if needed.
5. Click **Save _n_ results**. You see "_n_ results entered — waiting for verification".

You can fill some tests now and the rest later. Each saved result shows its value, unit, flag, reference range and the status **To verify**.

Flags (low, high, critical low, critical high, abnormal) are computed against the laboratory's reference range for the patient's sex and age at the
moment you enter the result. The range is copied onto the result, so later catalog changes never change how an old result reads. Flags are an aid to
interpretation, not a diagnosis. Tests with no reference range show "No reference range" and are not flagged.

When a result was entered on an instrument, it shows the QC state at entry (**QC accepted**, **QC warning**, **QC rejected** or **No QC**) and the
reagent lots in use. A result entered while QC was rejected says "QC was rejected when this result was entered — review before verifying."

### Attach a file to a result

You can attach instrument printouts, images (a smear, a culture plate) or an outside laboratory's report.

1. On a result with status **To verify**, click **Attach a file (PDF or image, up to 10 MB)**.
2. Choose the file (PDF, JPEG, PNG, HEIC or TIFF). The file name becomes its title.
3. To remove a file, click **Remove…**, give a reason (at least 5 characters), and click **Remove**. The file is kept in the record, not deleted.

Files can be added or removed only while the result is waiting for verification. From verification on they are frozen with the result. To change
them later, correct the result and attach files to the new version. A file that shows **Upload not finished** blocks verification — remove it or
attach it again. Click **Open** to view a file. Clinicians see attachments only after the result is released. Patients do not see attachments in
MyHealth.

## How to verify, approve and release results

Each result moves through three sign-offs:

| Status on screen | Next step | Button      | Permission needed    |
| ---------------- | --------- | ----------- | -------------------- |
| **To verify**    | Verify    | **Verify**  | `lab.result.verify`  |
| **To approve**   | Approve   | **Approve** | `lab.result.approve` |
| **To release**   | Release   | **Release** | `lab.result.release` |
| **Released**     | — (done)  | —           | —                    |

1. Go to the **Verify**, **Approve** or **Release** stage and open the specimen.
2. Check each result: value, flag, reference range, comment, QC state and attachments.
3. Click the button on each result, or **Verify all _n_** / **Approve all _n_** / **Release all _n_** to sign off every result on the specimen at the
   same step.

Each result shows who entered, verified, approved and released it. If your facility turned on **Release results automatically when approved**,
approving also releases.

**Separation of duties:** by default, the person who entered a result cannot verify or approve it. The facility policy can allow it; such a sign-off
shows "(self, by facility policy)" on the result.

Once released, the result appears on the patient record (see [Chapter 2](02-patients.md)) and in the consultation, with a printable report per order.
Patients see a released result in MyHealth only if the test is set up as **Released results may be shown to the patient** and, for a critical
result, after the critical result is acknowledged.

### Printable reports and the report archive

Released results can be printed per order from the patient record (**Printable reports**) or the consultation (**Report**). Only released results
are on the report. Each time results of an order are released, the system also stores a copy of the report as an archived PDF; corrections add a new
archived version and never replace an old one. You open archived reports from the patient record ([Chapter 2](02-patients.md)).

## How to correct or cancel a result

**Correct** creates a new version. The old version is never overwritten; it stays in the history marked superseded.

1. On the result, click **Correct…**.
2. Enter the **Corrected value** (and the **Instrument**, if the list appears).
3. Enter the **Reason for the correction**.
4. Click **Save correction**. The new version shows **Version _n_: _reason_** and goes through verification and approval again.

- To correct an unreleased result you need `lab.result.enter`.
- To correct a released result you need `lab.result.amend`. The screen warns: "This result was released. The corrected version replaces it after
  sign-off; the original stays in the history and the ordering practitioner is told." While the correction is being signed off, clinicians see no
  current value for that test. The ordering doctor gets an in-app notice when the corrected result is released, and patients who use MyHealth are
  told a result changed (without naming the test or value).

**Cancel** removes an unreleased result: click **Cancel result…**, give a **Reason for cancelling**, and click **Cancel result**. You need
`lab.result.enter`. A released result cannot be cancelled — correct it instead.

## How to handle a critical result

When a result with a critical flag is verified, the system raises a critical-result alert. The ordering doctor gets an in-app notice.

1. Open **Laboratory → Critical results** (`/laboratory/critical`). It lists alerts not yet acknowledged. Use **Show acknowledged** to see closed
   ones.
2. Each card shows the patient, test, value, flag, reference range, order, and who requested it. The badge says **Not yet communicated**,
   **Communicated — awaiting acknowledgement** or **Acknowledged**.
3. Laboratory staff document the call (needs `lab.critical.manage`):
   1. **Told to (name and role)** — prefilled with the ordering doctor.
   2. **How** — **Phone**, **In person**, **Secure message** or **Other**.
   3. **Note (optional)**.
   4. Tick **The recipient read the value back** if they did.
   5. Click **Document communication**.
4. The ordering side then clicks **Acknowledge** (anyone who can read results, `lab.result.read`). **Acknowledge** appears only after step 3: until
   the call is documented the card says "Acknowledgement opens once the laboratory has documented telling the care team."

The dashboard and the workbench status line show how many critical results are waiting. A critical result is not shown to the patient in MyHealth
until it is acknowledged.

## How to send tests to a reference laboratory

Tests your facility does not perform go to an outside **reference laboratory**. The order, collection and receipt are the usual ones. The send-out
sits between receipt and result entry.

**Electronic exchange with reference laboratories is not set up.** Nothing is sent electronically. The specimens travel with a printed manifest, and
you type the results in from the reference laboratory's report. **Send electronically** on a dispatch is refused until an interface is configured
(an integration dependency).

### Prepare a send-out

- **Automatically:** when a specimen for a test that is set up as referred out is received, a send-out is prepared.
- **By hand:** on the workbench, open a received specimen and click **Send to a reference laboratory…**. Choose the **Reference laboratory**, tick
  the tests, and click **Prepare send-out**. You need `lab.specimen.receive`.

A test being sent out is not on the **Enter results** worklist. The workbench shows it under **Referred to a reference laboratory** with its status.

### Dispatch with a manifest

You need `lab.specimen.receive`.

1. Open **Laboratory → Send-outs** (`/laboratory/send-outs`) and choose **To dispatch**. Send-outs are grouped by reference laboratory.
2. Untick any specimen that is not leaving now.
3. Enter the **Courier** (company or rider) and, optionally, the **Courier manifest / waybill** number.
4. Click **Record dispatch of _n_**. The system assigns a manifest number (`SM…`).
5. Click **Print manifest** in the message (or the manifest number under **Recent dispatches**). Send the printed manifest with the specimens.

The manifest lists each specimen with minimal identification (accession number, patient name and number, sex/age, specimen type and container,
collection time, test codes, STAT) and signature lines for the laboratory, the courier and the reference laboratory.

### Record results back

1. On **Send-outs**, choose **Awaiting results**. Each row shows how long the specimen has been out and when results are expected. A send-out past its
   expected turnaround is marked **overdue**.
2. When the report arrives, click **Results back…**, enter the reference laboratory's accession number, and click **Record results back**.
3. The test now appears on the **Enter results** worklist. Enter the values from their report. The entry panel says "From _laboratory_'s report …
   — recorded as performed by them".
4. Verify, approve and release as usual.

Results from a reference laboratory show **Performed by _laboratory_** on the workbench, the patient record and printed reports. If the reference
laboratory sends an amended report, enter it with **Correct…**.

### When the reference laboratory rejects the specimen, or you cancel

- **Rejected…** (needs `lab.specimen.reject`): enter their reason and, optionally, their accession number, then **Record rejection**. The test stays
  received. You can send it again, reject the specimen in-house and request recollection, or test it in-house.
- **Cancel…** (needs `lab.specimen.receive`): give a reason and click **Cancel send-out** (for example, tested in-house). Tell the reference
  laboratory too.

The **Closed** view lists finished send-outs with their outcome.

## How to manage the catalog

Open **Laboratory → Catalog** (`/laboratory/catalog`). Everyone with `lab.order.read` can look. To change anything you need `lab.catalog.manage`
(pathologist, organization administrator). The catalog is shared by the whole organization; the policy and referrals are per facility.

### Departments and specimen types

In the **Departments** and **Specimen types** cards, type a **code** and **Name** (and a **Container** for specimen types) and click **Add**. You
need at least one of each before you can add a test.

### Add a test

1. Under **Tests**, click **New test**.
2. Fill in **Code**, **Name**, **Department** and **Specimen**.
3. Choose the **Result type**: **Numeric**, **Coded (choose from a list)** or **Text**.
   - Numeric: **Unit** and **Decimal places**.
   - Coded: **Allowed values (comma-separated)** and **Abnormal values**.
4. Optional: **LOINC** code (tests with the same LOINC code line up in result trends), **Turnaround (minutes)**, **Requires fasting**.
5. Leave **Released results may be shown to the patient** ticked unless the result must not appear in MyHealth.
6. Click **Add test**.

Click **Deactivate** to stop a test from being ordered, and **Activate** to allow it again. Other test details cannot be edited on this page.

### Add a reference range

1. On the test row, click **Range**.
2. Choose **Sex** (**Any**, **Male**, **Female**), **From age (y)** and **Under age (y)**.
3. For numeric tests enter **Low**, **High**, and optionally **Critical ≤** and **Critical ≥**. For other tests enter **Expected (text)**.
4. Click **Add range**.

The new range takes effect now. A range for the same sex and ages replaces the current one from now on; results already entered keep the range they
were read against. Use your laboratory's validated ranges for its method and population. Patients recorded with a sex other than male or female get
only **Any** ranges — the system never guesses.

### Add a panel

In the **Panels** card, enter a code and name, tick the tests, and click **Add panel**. Ordering a panel orders its active tests.

### Set the facility's laboratory policy

The **Laboratory policy · _facility_** card applies to the facility selected in the top bar.

- **Allow the person who entered a result to verify it**
- **Allow the person who entered a result to approve it**
- **Release results automatically when approved**
- Quality control settings — see [Chapter 7](07-laboratory-quality.md#how-to-set-the-qc-and-competency-policy).

By default all three are off: separation of duties and manual release. Change them only where staffing requires it. After a change, enter a **Reason
for the change** and click **Save policy**. Every change is recorded in the audit trail. While self sign-off is allowed, the card shows **Separation
of duties relaxed at this facility**.

### Set up reference laboratories and referred tests

In the **Reference laboratories** card (you need `lab.catalog.manage`):

1. Click **Add reference laboratory**. Enter **Code**, **Name**, and optionally **Accreditation / licence reference**, **Contact person**, **Phone**,
   **Email** and **Address**. Click **Save**.
2. The accreditation or licence reference is recorded as you give it. The system does not verify it.
3. **Deactivate** a laboratory to stop new send-outs to it.

Under **Tests referred out from _facility_**, choose the **Test**, the **Reference laboratory** and optionally a **Turnaround (hours)** (counted
from dispatch; blank uses the test's own), then click **Refer out**. To perform a test in-house again, click **Stop referring…**, give a reason, and
click **Stop**.

## Rules the system enforces

- A released result is never overwritten. Corrections create a new version; the old one stays readable.
- A result is entered only after its specimen is received, and only at the facility of the order.
- Each test has one current result. To change it, use **Correct…**.
- Numeric values must respect the test's decimal places. Coded values must be one of the allowed values.
- Verify, approve and release each need their own permission. The person who entered a result cannot verify or approve it unless the facility policy
  allows it.
- Only approved results can be released. Only released results are shown to clinicians outside the laboratory.
- A result cannot be verified while an attachment upload is unfinished. Attachments cannot change after verification.
- A released result cannot be cancelled, and a specimen with released results cannot be rejected.
- A referred test cannot be entered until you record that the reference laboratory's results came back. Only one send-out per test can be in flight.
- Reference ranges take effect now or later, never in the past, and ranges for the same sex and ages cannot overlap.
- With the QC or competency policy on, results can be refused — see [Chapter 7](07-laboratory-quality.md).
- Laboratory licensing and DOH reporting rules are not built in. Validate them against current official issuances.

## Troubleshooting / common messages

| Message                                                                                                                   | Meaning                                                                | What to do                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Scan or type an accession number (digits only).                                                                           | The scan box got letters or too few digits.                            | Rescan the label or type the number.                                     |
| No specimen _number_ at _facility_.                                                                                       | No specimen with that number at the selected facility.                 | Check the facility in the top bar and the number.                        |
| Collect this order at the facility it was placed for                                                                      | The order belongs to another facility.                                 | Switch facility, or collect at the right site.                           |
| Some tests were already collected or cancelled                                                                            | A colleague acted on the order first.                                  | The list refreshes; check what is left.                                  |
| The specimen is already received                                                                                          | It was received already.                                               | Continue at **Enter results**.                                           |
| Results from this specimen were released; correct them instead of rejecting the specimen                                  | Rejection is not allowed after release.                                | Use **Correct…** on the results.                                         |
| _Test_ is reported to _n_ decimal place(s) / _Test_ takes one of: …                                                       | The value does not fit the test.                                       | Re-enter the value in the right format.                                  |
| This test already has a result; enter a correction instead                                                                | There is a current result for the test.                                | Use **Correct…**.                                                        |
| The person who entered a result cannot also verify it at this facility (separation of duties)…                            | You entered this result.                                               | Ask a colleague, or ask for a policy change.                             |
| The result is _status_; it cannot be _verified_ now                                                                       | Someone signed it off already, or it was corrected.                    | Refresh and check the current status.                                    |
| An attachment of this result is still uploading: finish or remove it before verifying                                     | A file shows **Upload not finished**.                                  | Remove the file and attach it again.                                     |
| The file is larger than 10 MB. Scan at a lower resolution or attach a PDF.                                                | The attachment is too big.                                             | Use a smaller file.                                                      |
| A released result is corrected, never cancelled                                                                           | You tried to cancel a released result.                                 | Use **Correct…** (needs `lab.result.amend`).                             |
| Correcting a released result requires lab.result.amend                                                                    | You lack the permission.                                               | Ask a pathologist.                                                       |
| This test was sent to _laboratory_; record that its results came back before entering them …                              | The send-out is still open.                                            | On **Send-outs**, click **Results back…** first, or cancel the send-out. |
| _Test_ is already being sent out                                                                                          | A send-out for this test is in flight.                                 | Check **Send-outs**.                                                     |
| No electronic interface to this reference laboratory is configured …                                                      | **Send electronically** is an integration dependency.                  | Send the specimens with the printed manifest.                            |
| The critical result is already communicated / acknowledged                                                                | A colleague did it first.                                              | Refresh the page.                                                        |
| The laboratory has not yet documented telling the care team about this critical result; it can be acknowledged after that | Nobody has documented the call yet.                                    | Ask the laboratory to document the call first.                           |
| This range overlaps another range for the same sex and ages                                                               | Two ranges would apply to the same patients.                           | Adjust the ages or sex.                                                  |
| A test with that code exists                                                                                              | Test codes are unique.                                                 | Use a different code.                                                    |
| No QC has been run for this test on this instrument within the facility's QC window. Run QC before …                      | QC is required at your facility.                                       | See [Chapter 7](07-laboratory-quality.md).                               |
| You cannot enter _test_ results at this facility: … Ask your section head.                                                | Competency is required and yours is not current.                       | See [Chapter 7](07-laboratory-quality.md).                               |
| Select your facility in the top bar first.                                                                                | No facility is selected.                                               | Choose a facility in the top bar.                                        |
| Someone else updated this just now. The screen has been refreshed — check it and try again.                               | Another user changed the record (for example a test or reference lab). | Check and repeat your change.                                            |

## Related chapters

- [1. Getting started](01-getting-started.md) — facility selection, notifications bell, dashboard
- [2. Patients](02-patients.md) — results, trends and archived reports on the patient record
- [4. Consultations and care plans](04-consultations-and-care-plans.md) — ordering tests
- [7. Laboratory quality](07-laboratory-quality.md) — instruments, QC, reagent lots, temperatures, nonconformances, EQA, competency
- [9. Pharmacy and inventory](09-pharmacy-and-inventory.md) — reagent stock
- [10. Billing](10-billing.md) — charges for laboratory tests
- [12. Patient portal](12-patient-portal.md) — what patients see
- [13. Administration](13-administration.md) — roles and permissions
