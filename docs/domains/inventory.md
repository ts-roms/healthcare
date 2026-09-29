# Inventory

## Purpose

Stock of medicines, medical and dental supplies, laboratory reagents and consumables, and PPE at each facility's storage
locations: what is on hand, by lot and expiry, and every movement that changed it; purchase orders to suppliers; and
the stock contract other workflows use (dispensing, reagent loads). Code: `libs/inventory` (`scope:inventory`),
migrations `0026_inventory.sql`, `0052_inventory_procurement.sql` and `0061_inventory_valuation_supplier_invoices.sql`,
staff `/inventory`, `/inventory/purchase-orders`, `/inventory/supplier-invoices`, `/inventory/valuation`. It also values
stock at cost and records supplier invoices against purchase orders.

Not (yet) responsible for: reagent use per test run, accounting (general ledger, accounts payable ageing, withholding
tax, input VAT claims), government procurement rules (e.g. RA 9184 for public facilities), or the official
register formats for dangerous drugs and other regulated products (compliance dependencies — see below).

## Entities

- **Item** (`inventory_item`) — code, name, category (medicine, medical supply, reagent, laboratory consumable, dental
  supply, PPE, other), **stock unit** (tablet, vial, box…), whether it is tracked by **lot and expiry**, whether it is
  **controlled**, status. The stock unit and lot tracking are fixed once created.
- **Supplier** (`inventory_supplier`) — code, name, contact.
- **Location** (`inventory_location`) — a storage place at a facility (pharmacy, laboratory store, storeroom…).
- **Lot** (`inventory_lot`) — lot number and expiry as printed; items without lot tracking use one implicit lot.
- **Reorder level** (`inventory_stock_level`) — per location and item, in stock units.
- **Balance** (`inventory_balance`) — quantity per location and lot; **never negative** (check constraint).
- **Movement** (`inventory_movement`) — the **append-only ledger** (trigger): receipt, issue, transfer out/in (two rows
  sharing a group), adjustment (count), write-off, **return** (stock a workflow gives back); signed quantity, balance
  after, supplier and unit cost (receipts, centavos), reference, issued to (a department or purpose — never a patient
  identifier), reason, who, when, and its **source** when another workflow moved it (`prescription_dispense`,
  `lab_reagent_load`, `purchase_order_line`, `dental_procedure` + id). A source takes stock from a lot once and returns
  it at most once (partial unique index) — except a dental procedure (migration `0057`), which may take from a lot
  again and return part of it several times, each return checked against what it still holds; a return needs a
  source and a reason.
- **Reorder quantity** (`inventory_stock_level.reorder_quantity`, optional) — the quantity usually ordered, suggested on
  purchase orders.
- **Purchase order** (`inventory_purchase_order`) — number `PO-YYYY-NNNNNN` (per organization and year,
  `inventory_number_sequence`), facility, supplier, delivery location (of that facility), expected date, notes, status
  `draft → submitted → approved → partially_received → received`, or `cancelled` (nothing arrived) / `closed` (short,
  no more expected) with a reason; who drafted, submitted, approved, ended it and when; version. Never deleted; a
  finished order no longer changes; supplier and location are fixed once submitted (trigger). **The approver is never
  the submitter** (check constraint and service).
- **Purchase order line** (`inventory_purchase_order_line`) — item (once per order), quantity ordered in stock units,
  agreed unit cost (centavos, optional), quantity received (only grows, never above ordered). Lines change only while
  the order is a draft (trigger).

## Commands

| Command            | Rules                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Receive            | Lot number required for lot-tracked items (expiry recommended); supplier, unit cost and delivery reference optional.                  |
| Issue              | To a department or purpose. Lots **first-expiry-first-out** unless one is named; **expired lots are never issued**.                   |
| Transfer           | From a location of the selected facility to any active location of the organization (another branch included); FEFO like issues.      |
| Count (adjustment) | The physical count for a lot; the difference to the balance is posted; a reason is required; a count equal to the balance is refused. |
| Write off          | Expired, damaged or lost stock; a reason is required (expired lots can only leave this way).                                          |
| Issue for a source | Another domain's record (a dental procedure), several items at once, **inside the caller's transaction**; rules as an issue.          |
| Return from source | Unused stock back to the lot and location it was issued from; a reason; never more than issued to that source from the lot, net.      |

All: the location must belong to the **selected facility** and be active; the item active; one transaction locks the
balance rows, posts the movements, updates balances and audits; an **idempotency key** makes a retried request return
the same movements. **Controlled items** need a reason and a reference on every movement.

**Purchase orders**

| Command          | Rules                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft / edit     | Active supplier, active delivery location of the selected facility, active items, each item once. A draft is edited as a whole (lines replaced; version).     |
| Submit           | Draft → submitted.                                                                                                                                            |
| Approve          | Submitted → approved, by someone with `inventory.procurement.approve` **other than the submitter** (403).                                                     |
| Receive delivery | Approved or partly received. Per line: quantity ≤ outstanding (`over_receipt`), lot and expiry for lot-tracked items; the supplier's delivery reference.      |
|                  | One receipt movement per line (source = the line, supplier and agreed unit cost) in one group with the idempotency key; status becomes partly/fully received. |
| Cancel           | Draft, submitted or approved with nothing received; reason.                                                                                                   |
| Close short      | Approved or partly received; reason; nothing more expected.                                                                                                   |

**The stock contract (other workflows)** — `InventoryStockService`, called by the API's adapters behind each domain's
port, **inside the caller's transaction** so the workflow's record and the stock movement commit together:

- `consume(tx, actor, { locationId, itemId, quantity, lotId?, source, issuedTo, reference?, reason? })` — an issue from a
  location of the actor's facility (FEFO, never expired; controlled items need reason and reference).
- `restore(tx, actor, { source, reason })` — returns exactly what the source took, to the same locations and lots, once.
- `receiveFor(tx, actor, { locationId, supplierId, reference, idempotencyKey, lines })` — receipts for purchase order lines.
- `usableAt(organizationId, facilityId, categories)` — usable stock per location and item (what can be taken).
- `consume` and `issueForSource` take the **item categories** the calling workflow may use (`categories`), each list
  owned by that workflow's domain: dispensing `DISPENSABLE_CATEGORIES` (medicine, medical supply), reagent loads
  `REAGENT_CATEGORY`, dental supplies `DENTAL_SUPPLY_CATEGORIES` (dental and medical supply, medicine, PPE, other).
  Anything else is refused with `item_category_not_allowed` (details: item, category, allowed) — dispensing never hands
  over a laboratory reagent, whatever is kept in the same room.

## Queries

- Stock at the selected facility (optionally one location): on hand, **usable** (expired lots excluded), reorder level,
  status (out / low / in stock, computed on usable stock), lots with expiry status (expired / expiring within N days).
  Filters: low or out; expiring (default 60 days).
- Movements at the facility's locations (latest 200), optionally by item or location, with their source.
- Purchase orders of the facility (`?status=open` for drafts and orders still expecting goods), one order with lines,
  totals (priced lines) and whether the caller submitted it.
- **Reorder suggestions**: items with a reorder level at the facility's locations whose usable stock **plus the quantity
  still expected on open orders** is at or below the level; suggested quantity = the reorder quantity (none: the buyer
  decides); the last supplier and unit cost received at that location.
- Catalog: items, suppliers, locations (the organization's, or the facility's).

## Valuation

Operational figures for stock control — **not** an accounting or BIR valuation.

- **Lot cost:** the weighted average of the lot's priced receipts (the purchase-order line price, or the unit cost entered
  on a manual receipt), rounded to the centavo. A receipt without a cost (a donation, an old record) does not count; a lot
  with no priced receipt is **unvalued** and reported as such, never guessed.
- **Cost on every movement:** each movement other than a receipt (issue, dispense, reagent load, dental use, transfer,
  count adjustment, write-off, return) records the lot's cost when it is posted (`InventoryStockService.post` →
  `lotUnitCost`), so the value of what was used in a period never changes afterwards, even if the lot is bought again at
  another price. Movements from before migration `0061` have no cost and count as unvalued.
- **Stock value** (`GET valuation`): the quantity on hand of each lot times its cost, per item and location, with totals
  by category and location, at the selected facility.
- **Received and used** (`GET valuation/usage?from=&to=`, ≤ 366 local days in the facility's time zone): quantities and
  values per kind of movement and workflow (received on purchase orders or otherwise, issued, dispensed, laboratory,
  dental, written off, count adjustments, transfers, returns), and the ten items used most by value.
- A supplier invoice's price does **not** change stock cost: a difference from the order is shown on the invoice and
  approved with a note (below).

## Supplier invoices

Recorded against a purchase order of the selected facility, line by line (`POST purchase-orders/{id}/invoices`):

- **Three-way match:** each order line shows ordered, received and invoiced (on valid invoices). An invoice line may cover
  at most what was received and not yet invoiced (`invoiced_beyond_received`, with the quantity still invoiceable);
  invoicing is serialized per order (row lock). The unit price is as invoiced; a difference from the order's price is shown
  per line (`variance`).
- **Amounts:** lines (quantity × unit price), the VAT **as stated on the invoice**, and their total, in centavos. No VAT or
  withholding rule is computed.
- **Status:** `recorded` → `approved` (by someone other than the recorder — also a database constraint; a price
  difference needs a note) → `paid` (date and payment reference; not before the invoice date, not in the future), or
  `void` from recorded or approved (reason). The supplier's invoice number is unique per supplier among valid invoices, so
  a voided one can be recorded again. Open invoices past their due date are **overdue**.
- **Immutable:** content never changes and nothing is deleted (guard trigger; lines append-only). A mistake is voided and
  recorded again.

## Events

- `InventoryStockLow` — when a movement takes an item's **usable** stock at a location from above its reorder level to at
  or below it (payload: location id, on hand, reorder level). No subscriber yet; reorder suggestions cover reordering.
- `InventoryPurchaseOrderSubmitted`, `InventoryPurchaseOrderApproved`, `InventoryPurchaseOrderReceived` (payload: PO
  number, supplier, location; received: movement group and status). No subscribers yet.
- `InventorySupplierInvoiceRecorded` (with the number of lines priced differently), `…Approved`, `…Paid`, `…Voided`
  (payload: purchase order, supplier, total — ids and amounts only). No subscribers yet.

## Permissions

| Permission                      | Roles                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| `inventory.read`                | org_admin, inventory_officer, medical_technologist, nurse            |
| `inventory.move`                | org_admin, inventory_officer, medical_technologist, nurse            |
| `inventory.adjust`              | org_admin, inventory_officer                                         |
| `inventory.catalog.manage`      | org_admin, inventory_officer                                         |
| `inventory.procurement.manage`  | org_admin, inventory_officer (receiving also needs `inventory.move`) |
| `inventory.procurement.approve` | org_admin                                                            |
| `inventory.valuation.read`      | org_admin, inventory_officer                                         |

Supplier invoices: recording, marking paid and voiding need `inventory.procurement.manage`, approving
`inventory.procurement.approve`; reading them `inventory.read`.

`inventory.read` and `inventory.move` are also held by `pharmacist` and `dental_assistant`. System role **Inventory
officer** (`inventory_officer`); an organization can grant approval to another role (e.g. a purchasing head). Movements and stock views are facility-scoped (the
`X-Facility-Id` of the request).

## API

`/api/v1/inventory`: `GET/POST items`, `PATCH items/{id}`, `GET/POST suppliers`, `GET/POST locations`
(`?scope=facility`), `PUT locations/{id}/items/{itemId}/reorder-level`, `GET stock` (`?show=low|expiring&withinDays=&locationId=`),
`GET movements`, `POST receipts | issues | transfers | adjustments | write-offs`, `GET reorder-suggestions`
(`?locationId=`), `GET/POST purchase-orders` (`?status=open|draft|…`), `GET/PUT purchase-orders/{id}`,
`POST purchase-orders/{id}/submit | approve | receipts | cancel | close`, `GET purchase-orders/{id}/invoicing`,
`POST purchase-orders/{id}/invoices`, `GET supplier-invoices` (`?status=open|overdue|recorded|approved|paid|void&purchaseOrderId=`),
`GET supplier-invoices/{id}`, `POST supplier-invoices/{id}/approve | payment | void`, `GET valuation` (`?locationId=`),
`GET valuation/usage` (`?from=&to=&locationId=`). The reorder level `PUT` takes an optional `reorderQuantity`. Audit
actions `inventory.*` (`inventory.return`, `inventory.purchase-order.create | update | submit | approve | receive | cancel |
close`, `inventory.supplier-invoice.record | approve | pay | void`).

## Database relationships

Composite same-organization foreign keys throughout; balances keyed by (location, lot); lots unique per item, lot number
and expiry; the ledger is append-only; a partial unique index enforces one movement group per idempotency key. A
movement's `unit_cost` is the purchase price on receipts and the lot's cost at posting on every other movement (only
receipts name a supplier). Supplier invoices reference their order, supplier and facility; each invoice line references
a line **of the same order** (composite keys through `(invoice_id, purchase_order_id)` and
`(purchase_order_id, purchase_order_line_id)`).

## Integration points

- Laboratory (`libs/laboratory/CLAUDE.md`, Phase 9): reagent lots here are loaded on laboratory instruments and
  recorded on results and QC runs ([laboratory-quality.md](laboratory-quality.md)), read through `InventoryQueries`
  (`lot`, `lotsInStock`) behind the laboratory's port. Loading can take the lot's stock from a location in the load's
  transaction (`consume`, source `lab_reagent_load`, reference = the instrument code). Consumption per test is not wired.
- Dispensing ([prescription.md](prescription.md)): each dispense takes stock (`consume`, source `prescription_dispense`,
  reference = the prescription number); a reversal returns it (`restore`). Adapter: `apps/api/src/app/adapters/inventory-adapters.ts`.
- Dental ([dental.md](dental.md#supplies-used)): the supplies a procedure used are issued through
  `InventoryStockService.issueForSource` (several items in one movement group, idempotent) and unused ones returned
  through `returnForSource` (partial, never more than the procedure still holds from the lot), behind dentistry's
  `DentalSupplies` port, in dentistry's transaction. Source `dental_procedure`; the staff movements list shows
  "Dental procedure". Items, locations and usable stock are read through `InventoryQueries`.
- Billing: supply charges are billing's concern (charge capture), not inventory's.

## Open questions / assumptions

- **Compliance dependency:** record-keeping for dangerous drugs and controlled precursors (PDEA / Dangerous Drugs Board)
  and FDA product rules are not implemented; "controlled" only enforces a reason and reference per movement. See
  `docs/interoperability/dependencies.md`.
- Valuation is a weighted average per lot (not FIFO layers); it is an operational figure, not the organization's
  accounting valuation. Accounts payable, withholding tax (BIR forms) and input VAT are not implemented — compliance and
  accounting dependencies for the organization's accountant.
- **Compliance dependency:** public facilities' procurement rules (RA 9184 and its IRR, PhilGEPS) are not encoded; purchase
  orders here are the facility's internal ordering record.
- Expiry uses the facility's local date; the printed expiry date is the last usable day.
