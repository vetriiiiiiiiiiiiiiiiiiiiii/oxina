# Database design

PostgreSQL 17, schema in `prisma/schema.prisma`, migrations in `prisma/migrations` (the source of truth — never create tables by hand). 70+ models; UUID primary keys; human-facing numbers come from `NumberSequence`.

## Relationship diagram (core)

```mermaid
erDiagram
  BusinessGroup ||--o{ BusinessUnit : has
  BusinessUnit ||--o{ Branch : has
  BusinessUnit ||--o{ VehicleModel : sells
  BusinessUnit ||--o{ InventoryItem : stocks
  BusinessUnit ||--o{ Supplier : buys_from
  Branch ||--o{ Department : has
  Branch ||--o{ InventoryLocation : has
  Branch ||--o{ Employee : employs
  User ||--o{ UserRole : has
  Role ||--o{ RolePermission : grants
  Permission ||--o{ RolePermission : in
  User ||--o{ UserBranchAssignment : "works at"
  User ||--o{ UserBusinessUnitAssignment : "oversees"
  User ||--o| Employee : "is"
  User ||--o| Customer : "portal login"
  User ||--o{ Session : has

  Customer ||--o{ CustomerVehicle : owns
  Customer ||--o{ CustomerConsent : gives
  Customer ||--o{ CustomerDocument : "optional ID docs"
  Customer ||--o{ ServiceJob : requests
  CustomerVehicle ||--o{ ServiceJob : "serviced in"
  Branch ||--o{ ServiceJob : handles

  ServiceJob ||--o{ ServiceJobAssignment : staffed_by
  ServiceJob ||--o{ ServiceInspection : inspected
  ServiceJob ||--o{ RepairTask : contains
  RepairTask ||--o{ RepairTaskDependency : "depends on"
  RepairTask ||--o{ MechanicWorkLog : logs
  ServiceJob ||--o{ RepairEstimate : estimated
  RepairEstimate ||--o{ EstimateLineItem : lines
  RepairEstimate ||--o{ CustomerApproval : decisions
  EstimateLineItem |o--o| SparePartRequest : "requested as"
  ServiceJob ||--o{ SparePartRequest : needs
  SparePartRequest ||--o| StockReservation : reserves
  SparePartRequest ||--o| SparePartIssue : "issued once"
  ServiceJob ||--o{ QualityInspection : checked
  QualityInspection ||--o{ TestRide : includes
  ServiceJob ||--o{ Invoice : billed
  ServiceJob ||--o| ServiceHandover : handed_over
  ServiceJob ||--o{ ServiceTimelineEvent : "customer timeline"
  ServiceJob ||--o{ InternalActivityLog : "internal log"
  ServiceJob ||--o{ FollowUp : "follow-ups"
  ServiceJob ||--o| CustomerFeedback : rated

  InventoryItem ||--o{ InventoryBalance : "per location"
  InventoryLocation ||--o{ InventoryBalance : holds
  InventoryItem ||--o{ StockMovement : ledger
  PurchaseOrder ||--o{ PurchaseOrderLine : lines
  GoodsReceipt ||--o{ GoodsReceiptLine : lines
  StockTransfer ||--o{ StockTransferLine : lines

  Branch ||--o{ Vehicle : "showroom stock"
  VehicleModel ||--o{ Vehicle : is
  SalesLead ||--o{ LeadActivity : history
  SalesLead ||--o{ SalesQuotation : quoted
  VehicleBooking }o--|| Customer : for
  VehicleBooking }o--o| Vehicle : allocates
  Offer ||--o{ Coupon : has
  Invoice ||--o{ InvoiceLineItem : lines
  Invoice ||--o{ Payment : paid_by
  Payment ||--o{ Refund : refunded
  Invoice ||--o{ CreditNote : corrected_by
  Warranty ||--o{ WarrantyClaim : claims
```

## Integrity rules enforced by the database

Hand-written SQL appended to the initial migration:

| Rule | Mechanism |
|---|---|
| Stock never negative; reserved ≤ on hand | `CHECK` on `InventoryBalance` |
| Positive quantities / amounts; rating 1–5; min ≤ max durations; no self-dependency | `CHECK` constraints |
| One spare-part issue per request (no duplicate issues) | `UNIQUE (SparePartIssue.requestId)` |
| One reservation per request | `UNIQUE (StockReservation.sparePartRequestId)` |
| A vehicle in at most one live booking | partial unique index |
| One non-cancelled invoice per service job | partial unique index |
| Finalized invoice amounts/number/lines immutable; cancelled can't reopen; non-draft can't be deleted | triggers `oxina_protect_finalized_invoice*` |
| Audit log, stock ledger, customer approvals, customer timeline, credit notes are append-only | trigger `oxina_block_mutation` |
| Unique VIN / engine number / registration / document numbers; unique part number per business unit | unique indexes |

## Other conventions

* **Branch scoping** — every operational table carries `branchId` (indexed together with status/date). Customers are group-wide; staff see a customer if created at, or transacting with, one of their branches.
* **No destructive cascades** on operational/financial history — relations use `onDelete: Restrict`; users, branches, units, employees and items are *deactivated*, never deleted. Only ephemeral auth rows (sessions, reset tokens) cascade.
* **Money** `Decimal(14,2)`; tax rates `Decimal(5,2)`; quantities are integers in the item's base unit (pcs, ml…).
* **Time** `timestamptz` (UTC); branches carry `timezone`, working hours/days and holidays for display and ETA.
* **Settings** — `BranchSetting` → `BusinessSetting` → built-in defaults (`src/lib/services/settings.ts`).
* **Inventory available quantity** = `quantityOnHand − quantityReserved`, never stored separately.
