# Inventory

## Purpose

Stock of medicines, medical and dental supplies, laboratory reagents and consumables, and PPE at each facility's storage
locations: what is on hand, by lot and expiry, and every movement that changed it. Code: `libs/inventory`
(`scope:inventory`), migration `0026_inventory.sql`, staff `/inventory`.

Not (yet) responsible for: purchase orders and procurement, automatic consumption from clinical or laboratory workflows
(dispensing from a prescription, reagent use per test run), costing/valuation methods, or the official register
formats for dangerous drugs and other regulated products (a compliance dependency — see below).

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
  sharing a group), adjustment (count), write-off; signed quantity, balance after, supplier and unit cost (receipts,
  centavos), reference, issued to (a department or purpose — never a patient identifier), reason, who, when.

## Commands

| Command            | Rules                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Receive            | Lot number required for lot-tracked items (expiry recommended); supplier, unit cost and delivery reference optional.                  |
| Issue              | To a department or purpose. Lots **first-expiry-first-out** unless one is named; **expired lots are never issued**.                   |
| Transfer           | From a location of the selected facility to any active location of the organization (another branch included); FEFO like issues.      |
| Count (adjustment) | The physical count for a lot; the difference to the balance is posted; a reason is required; a count equal to the balance is refused. |
| Write off          | Expired, damaged or lost stock; a reason is required (expired lots can only leave this way).                                          |

All: the location must belong to the **selected facility** and be active; the item active; one transaction locks the
balance rows, posts the movements, updates balances and audits; an **idempotency key** makes a retried request return
the same movements. **Controlled items** need a reason and a reference on every movement.

## Queries

- Stock at the selected facility (optionally one location): on hand, **usable** (expired lots excluded), reorder level,
  status (out / low / in stock, computed on usable stock), lots with expiry status (expired / expiring within N days).
  Filters: low or out; expiring (default 60 days).
- Movements at the facility's locations (latest 200), optionally by item or location.
- Catalog: items, suppliers, locations (the organization's, or the facility's).

## Events

- `InventoryStockLow` — when a movement takes an item's **usable** stock at a location from above its reorder level to at
  or below it (payload: location id, on hand, reorder level). No subscriber yet; intended for notifications/reordering.

## Permissions

| Permission                 | Roles                                                     |
| -------------------------- | --------------------------------------------------------- |
| `inventory.read`           | org_admin, inventory_officer, medical_technologist, nurse |
| `inventory.move`           | org_admin, inventory_officer, medical_technologist, nurse |
| `inventory.adjust`         | org_admin, inventory_officer                              |
| `inventory.catalog.manage` | org_admin, inventory_officer                              |

New system role **Inventory officer** (`inventory_officer`). Movements and stock views are facility-scoped (the
`X-Facility-Id` of the request).

## API

`/api/v1/inventory`: `GET/POST items`, `PATCH items/{id}`, `GET/POST suppliers`, `GET/POST locations`
(`?scope=facility`), `PUT locations/{id}/items/{itemId}/reorder-level`, `GET stock` (`?show=low|expiring&withinDays=&locationId=`),
`GET movements`, `POST receipts | issues | transfers | adjustments | write-offs`. Audit actions `inventory.*`.

## Database relationships

Composite same-organization foreign keys throughout; balances keyed by (location, lot); lots unique per item, lot number
and expiry; the ledger is append-only; a partial unique index enforces one movement group per idempotency key.

## Integration points

- Laboratory (`libs/laboratory/CLAUDE.md`, Phase 9): results now reference their instrument and QC run
  ([laboratory-quality.md](laboratory-quality.md)); reagent lots here are the lots they should reference next. Not
  wired yet.
- Prescriptions/dispensing and dental procedures could consume stock through a port — not wired yet.
- Billing: supply charges are billing's concern (charge capture), not inventory's.

## Open questions / assumptions

- **Compliance dependency:** record-keeping for dangerous drugs and controlled precursors (PDEA / Dangerous Drugs Board)
  and FDA product rules are not implemented; "controlled" only enforces a reason and reference per movement. See
  `docs/interoperability/dependencies.md`.
- Valuation (FIFO/weighted average) and purchase orders come with procurement.
- Expiry uses the facility's local date; the printed expiry date is the last usable day.
