# Architecture — Oxina Groups Unified Operations Platform

## 1. Overview

A single Next.js 15 (App Router, TypeScript) application backed by PostgreSQL 17 through Prisma 6.

```
Browser (staff app / customer portal)
   │  HTTPS (Nginx, Let's Encrypt)
   ▼
Next.js server ── Server Components (reads) ──┐
   │            └─ Route Handlers /api/* ─────┤──► Service layer (src/lib/services) ──► Prisma ──► PostgreSQL
   │                                           │        • authorization (Actor + branch scope)
   │  SSE /api/service/jobs/:id/stream ◄── event bus + 5 s DB check     • Zod validation
   ▼                                                    • transactions, row locks, audit
Worker (scripts/worker.ts) — outbox delivery (SMTP), follow-up reminders, housekeeping
```

**Hierarchy:** Oxina Groups → Business Units (Royal Enfield, Tata, Hyundai, Suzuki, Hotels, Restaurants…) → Branches → Departments → users & operations. No branch limit is hard-coded.

### Key design decisions

| Decision | Choice | Why |
|---|---|---|
| Authentication | Server-managed sessions: 160-bit random token in an `httpOnly`, `SameSite=Lax` cookie; SHA-256 of the token stored in `Session`; Argon2id password hashes (`@node-rs/argon2`, `@oslojs/*`). | This is the pattern the Lucia maintainers recommend now that Lucia v3 is deprecated; no JWTs to revoke, instant deactivation. |
| Authorization | Every service function receives an `Actor` built server-side from the session. `requirePermission()` + `assertBranch()`/`branchFilter()` on every query. Out-of-scope records return **404**, not 403, so existence isn't leaked. | Frontend hiding is cosmetic only. |
| Role scope | `GROUP` (all branches), `BUSINESS_UNIT` (owners / OEM reps), `BRANCH` (explicit assignments), `SELF` (customers). | Matches the brief's permission rules. A user's roles apply in all of their assigned branches. |
| CSRF | Mutating requests must carry a same-origin `Origin` header (checked in `src/lib/api.ts`) plus `SameSite=Lax` cookies. | |
| Business rules | In services, *and* in the database where possible (CHECK constraints, partial unique indexes, immutability triggers). | Defence in depth: a bug or a manual SQL session still can't oversell stock or rewrite a finalized invoice. |
| Concurrency | Stock changes lock the `InventoryBalance` row (`SELECT … FOR UPDATE`) in one primitive (`applyStockChange`); workflow steps lock the `ServiceJob` row; tasks use optimistic versions; one `SparePartIssue` per request (unique). | Tested with concurrent requests. |
| Numbering | `NumberSequence` upsert-increment inside the creating transaction → `OXI-RE-2026-000001`, `INV-RE-…`, `RCPT-…`, etc. | Controlled, per business unit and year. |
| Real-time | SSE per job with in-process event bus + 5-second DB change check (works across multiple app containers); client falls back to 20-second polling. | |
| Jobs | Postgres-backed outbox (`NotificationDelivery`) claimed with `FOR UPDATE SKIP LOCKED` by the worker. | No Redis needed; safe with several workers. |
| Files | Storage driver (`local` disk or S3-compatible). Downloads need a session **and** a 5-minute HMAC token bound to file + user; magic-byte type sniffing; 10 MB cap. | |
| Sensitive identifiers | Optional; AES-256-GCM encrypted with a key from the environment; masked in UI; every reveal audited. | |
| Money | `Decimal(14,2)` everywhere; tax-exclusive line maths with half-up rounding (`src/lib/money.ts`). | |
| Time | All timestamps `timestamptz` (UTC); displayed in each branch's time zone. | |

## 2. Service-centre workflow (core of release 1)

```
RECEIVED → INSPECTION → AWAITING_APPROVAL → APPROVED ⇄ PARTS_PENDING → IN_REPAIR → QUALITY_CHECK → FINAL_BILLING → READY_FOR_DELIVERY → DELIVERED → CLOSED
                         ▲  (supplementary estimate from APPROVED / IN_REPAIR / QUALITY_CHECK)          │ QC fail ─► IN_REPAIR
```

Transitions are whitelisted in `src/lib/services/service/common.ts`. Highlights:

* **Approval gate** — chargeable tasks have `requiresApproval`; they cannot start until approved (emergency jobs may start *safety-critical* tasks). Customers approve per repair in the portal; staff may record in-person/phone decisions (separate permission, audited). Rejected repairs are cancelled with their parts.
* **Parts** — "Check availability" creates one request per approved part line: reserve if available (row-locked), otherwise mark `UNAVAILABLE`, block dependent tasks, notify warehouse/advisor, show the prescribed customer message and queue the templated email. Procurement records an expected date (no date ⇒ no ETA is promised). Goods receipts and transfer receipts allocate stock to waiting jobs first (priority, then FIFO) and unblock tasks.
* **Tasks** — `PENDING → READY → IN_PROGRESS → PAUSED/BLOCKED → COMPLETED`; pause/block require a reason; every transition is a `MechanicWorkLog` row; multiple mechanics and parallel tasks are supported with dependencies.
* **QC** — mandatory checklist items must pass; a completed OK test ride is required when flagged; failure returns chosen tasks to `READY` (rework count) with a reason.
* **Billing** — invoice built from *approved labour for completed tasks* + *parts actually issued*; finalizing assigns the number and freezes it (trigger-enforced). Payments count only once confirmed; partial payments are configurable; credit notes/cancellation for corrections.
* **Delivery** — ready requires QC gate + finalized invoice; handover requires checklist, acknowledgement and zero balance (configurable), releases leftover reservations, closes the job and schedules follow-ups (next day, 3 days, feedback, service reminder).
* **Two logs** — `ServiceTimelineEvent` (customer-visible, append-only) and `InternalActivityLog` (staff only). The portal reads a hand-picked allow-list projection (`customerJobView`).

## 3. ETA engine (`src/lib/eta`)

Pure functions, unit-tested. Remaining work is list-scheduled twice (min and max durations) over the branch's working calendar (hours, working days, holidays), respecting task dependencies, mechanic lanes (parallel work), each mechanic's existing workload on other jobs, recorded part arrival dates and pending customer approval (configurable assumed response time). QC, test ride and billing durations are appended. Output: earliest/latest, confidence (`FIRM`, `RANGE`, `PROVISIONAL`, `UNKNOWN`) and a breakdown (active minutes, queue minutes, parts wait, elapsed). It is recalculated on every event that affects it, and the job shows when it was last updated. Durations are configurable per business unit, branch and model (`RepairDurationStandard`; seeded with the brief's demonstration defaults).

## 4. Role–permission matrix

Source of truth: `src/lib/rbac/permissions.ts` (synced into the DB by the seed/bootstrap). Generated table:

| Permission | SA | OWN | BM | SALES | WH | ADV | BILL | MECH | QC | OEM | CUST |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `org.view` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `org.manage` | ● |  |  |  |  |  |  |  |  |  |  |
| `dashboard.group` | ● | ● |  |  |  |  |  |  |  |  |  |
| `dashboard.branch` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `users.view` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `users.manage` | ● |  |  |  |  |  |  |  |  |  |  |
| `settings.manage` | ● |  |  |  |  |  |  |  |  |  |  |
| `audit.view` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `showroom.view` | ● | ● | ● | ● |  |  |  |  |  |  |  |
| `showroom.leads.manage` | ● |  | ● | ● |  |  |  |  |  |  |  |
| `showroom.quotations.manage` | ● |  | ● | ● |  |  |  |  |  |  |  |
| `showroom.bookings.manage` | ● |  | ● | ● |  |  |  |  |  |  |  |
| `showroom.pricing.approve` | ● |  | ● |  |  |  |  |  |  |  |  |
| `vehicles.view` | ● | ● | ● | ● |  |  |  |  |  |  |  |
| `vehicles.manage` | ● |  | ● |  |  |  |  |  |  |  |  |
| `vehicles.cost.view` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `offers.view` | ● | ● | ● | ● |  |  |  |  |  |  |  |
| `offers.manage` | ● |  | ● |  |  |  |  |  |  |  |  |
| `inventory.view` | ● | ● | ● |  | ● | ● | ● |  |  |  |  |
| `inventory.manage` | ● |  | ● |  | ● |  |  |  |  |  |  |
| `inventory.issue` | ● |  | ● |  | ● |  |  |  |  |  |  |
| `inventory.transfer` | ● |  | ● |  | ● |  |  |  |  |  |  |
| `inventory.cost.view` | ● | ● | ● |  | ● |  |  |  |  |  |  |
| `purchases.manage` | ● |  | ● |  | ● |  |  |  |  |  |  |
| `purchases.approve` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `suppliers.manage` | ● |  | ● |  | ● |  |  |  |  |  |  |
| `service.view` | ● | ● | ● |  | ● | ● | ● |  | ● |  |  |
| `service.view.assigned` |  |  |  |  |  |  |  | ● |  |  |  |
| `service.job.create` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `service.job.manage` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `service.inspect` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `service.estimate.manage` | ● |  | ● |  |  | ● | ● |  |  |  |  |
| `service.estimate.record_approval` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `service.discount.approve` | ● |  | ● |  |  |  |  |  |  |  |  |
| `service.parts.request` | ● |  | ● |  |  | ● | ● | ● |  |  |  |
| `service.repair.assign` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `service.repair.work` | ● |  |  |  |  |  |  | ● |  |  |  |
| `service.quality.inspect` | ● |  | ● |  |  |  |  |  | ● |  |  |
| `service.handover` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `followups.manage` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `customers.view` | ● | ● | ● | ● |  | ● | ● |  |  |  |  |
| `customers.manage` | ● |  | ● | ● |  | ● |  |  |  |  |  |
| `customers.sensitive.view` | ● |  | ● |  |  |  |  |  |  |  |  |
| `employees.view` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `employees.manage` | ● |  | ● |  |  |  |  |  |  |  |  |
| `attendance.self` | ● |  | ● | ● | ● | ● | ● | ● | ● |  |  |
| `attendance.manage` | ● |  | ● |  |  |  |  |  |  |  |  |
| `targets.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| `targets.manage` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `billing.view` | ● | ● | ● |  |  |  | ● |  |  |  |  |
| `billing.manage` | ● |  | ● |  |  |  | ● |  |  |  |  |
| `billing.credit_note` | ● |  | ● |  |  |  |  |  |  |  |  |
| `payments.record` | ● |  | ● | ● |  |  | ● |  |  |  |  |
| `payments.confirm` | ● |  | ● |  |  |  | ● |  |  |  |  |
| `refunds.approve` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `expenses.submit` | ● |  | ● | ● | ● |  |  |  |  |  |  |
| `expenses.approve` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `warranty.view` | ● | ● | ● |  |  | ● |  |  |  | ● |  |
| `warranty.manage` | ● |  | ● |  |  | ● |  |  |  |  |  |
| `reports.view` | ● | ● | ● |  |  |  |  |  |  | ● |  |
| `reports.export` | ● | ● | ● |  |  |  |  |  |  |  |  |
| `notifications.templates.manage` | ● |  |  |  |  |  |  |  |  |  |  |
| `portal.access` |  |  |  |  |  |  |  |  |  |  | ● |

Scope: **SA** Super Admin (group) · **OWN** Group Owner (business unit) · **BM** Branch Manager (branch) · **SALES** Showroom Sales Executive (branch) · **WH** Stock / Warehouse Executive (branch) · **ADV** Service Advisor / Examiner (branch) · **BILL** Billing Executive (branch) · **MECH** Mechanic / Technician (branch) · **QC** Quality Inspector / Test Ride (branch) · **OEM** OEM Representative (business unit) · **CUST** Customer (self)

Additional rules enforced in code: mechanics see only jobs they are assigned to; sales executives see only their own leads; approvers cannot approve their own purchase orders, refunds, expenses, leave or attendance corrections; non-super-admins can only grant branch roles whose permissions they themselves hold, in their own branches; the last active Super Admin cannot be removed.

## 5. Implementation status — what is real, simulated, or future

| Area | Status |
|---|---|
| Auth (sessions, Argon2id, rate limiting, reset links, forced password change, deactivation) | **Implemented & tested** |
| RBAC + strict server-side branch isolation | **Implemented & tested** |
| Businesses / branches / departments / holidays | Implemented |
| Super Admin & branch dashboards (live DB figures, empty states) | Implemented |
| Royal Enfield showroom: vehicle stock, leads, test rides, quotations, bookings, coupons, finance/insurance/registration tracking, delivery + sale invoice + warranty | Implemented (UI + API); booking → delivery covered by an integration test |
| Inventory: items, balances, reservations, receipts, POs with approval, GRN, adjustments, damage, returns, audits, inter-branch transfers, reorder recommendations | **Implemented & tested** (core paths) |
| Service centre stages 1–11, mechanic board, QC/test ride, billing, handover, follow-ups | **Implemented & tested** |
| Customer portal: live timeline (SSE + polling fallback), estimate approval, invoices, bookings, feedback, shared photos | Implemented; isolation tested |
| ETA engine | **Implemented & unit-tested** |
| Billing: invoices, CGST/SGST/IGST split, payments (confirmation step), receipts, credit notes, cancellations, refunds (maker-checker), expenses | Implemented; immutability tested. **GST treatment must be validated by your accountant before production** (vehicle GST rate is a setting, default 28%). |
| Employees, prototype attendance, leave, corrections, targets, performance from records | Implemented. Attendance is **self-reported and labelled unverified** — no GPS/geofence/biometric. |
| Warranty records & claims, OEM-restricted view | Implemented |
| Reports (13) + CSV export with formula-injection protection | Implemented; scope tested |
| Audit log (append-only, DB-enforced) | Implemented |
| In-app notifications | Implemented |
| Email | Implemented via SMTP in the worker; **not verified against a real SMTP server in this environment**. Without SMTP, deliveries are recorded as `SKIPPED_NO_PROVIDER` — never as sent. `DELIVERED` is never set because plain SMTP gives no delivery receipt. |
| SMS / WhatsApp / push | **Not implemented** (future provider integrations; queued messages on those channels are skipped and recorded as such). |
| Online payment gateway | **Not implemented** — payments are recorded and confirmed by staff. No card data is stored; references that look like card numbers are rejected. |
| S3 storage driver | Implemented, **not verified** against a bucket here; local disk driver verified. |
| VPS deployment (systemd, Nginx, deploy/backup/restore scripts) | Written; **not run on a real server here**. The production build (`next build`) was verified locally. |
| Hotels, restaurants, Tata/Hyundai/Suzuki operations | Data model and access control are multi-business; the release-1 workflows are automotive (Royal Enfield). Hotel/restaurant-specific modules are future work. |
| End-to-end browser tests (Playwright) | Not written; flows verified manually in a browser. Integration tests exercise the same service layer the API uses. |
