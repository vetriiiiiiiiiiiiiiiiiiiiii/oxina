# Oxina Groups — Unified Operations Platform

Multi-business, multi-branch operations platform for Oxina Groups. Release 1 delivers a working **Royal Enfield showroom, stock management and motorcycle service centre**, on an architecture that already models every business unit (Tata, Hyundai, Suzuki, hotels, restaurants…) and any number of branches.

**Stack:** Next.js 15 (App Router, TypeScript) · Tailwind CSS v4 (own component kit, IBM Plex type) · PostgreSQL 17 · Prisma 6 · Zod · React Hook Form · Recharts · SSE · Argon2id sessions · systemd · Nginx.

## Highlights

- **Strict branch isolation** on the server: every query is scoped by the signed-in user's roles and branch assignments; changing a URL, id or parameter returns *not found*.
- **End-to-end service workflow** — reception → inspection → estimate & per-repair customer approval → parts check / reservation / shortage handling → mechanic tasks (parallel, dependencies, pause/block reasons) → QC & test ride → immutable invoice & confirmed payments → ready → handover → follow-ups.
- **Customer portal** with a live service timeline (Server-Sent Events, polling fallback), estimate approval, invoices, bookings and feedback — built from an allow-listed view that never exposes internal notes or costs.
- **Inventory you can trust** — row-locked reservations/issues, database CHECK constraints against negative stock, one issue per request, append-only movement ledger, transfers, POs with maker-checker approval, GRNs that serve waiting jobs first.
- **Realistic ETAs** — range-based scheduling over branch working hours, holidays, dependencies, mechanic workload, part arrival dates and approval wait; never promises a date without a recorded estimate.
- **Audit everything** — append-only audit log, internal activity log and customer timeline.

Read more: [Architecture & RBAC matrix](docs/ARCHITECTURE.md) · [Database design](docs/DATABASE.md) · [VPS deployment](docs/DEPLOYMENT.md).

## Local development

Requirements: Node.js 22+. PostgreSQL 17 is provided by `npm run db:local` (real PostgreSQL binaries via `embedded-postgres`) for development.

```bash
npm install
cp .env.example .env            # then fill in secrets (see below)
npm run db:local                # terminal 1 — PostgreSQL on :5433 with databases oxina + oxina_test
npx prisma migrate deploy       # apply migrations
ALLOW_DEMO_SEED=true npm run db:seed   # optional fictional demo data (development only)
npm run dev                     # http://localhost:3000
npm run worker                  # optional — processes the notification outbox
```

For local `.env` values, generate secrets with `openssl rand -base64 48` (`FILE_SIGNING_SECRET`) and `openssl rand -base64 32` (`DATA_ENCRYPTION_KEY`), and point `DATABASE_URL`/`TEST_DATABASE_URL` at the local server (`postgresql://oxina:oxina_local_dev@localhost:5433/oxina_dev` / `.../oxina_test`).

### Demo data (development only)

The seed creates fictional users at `*@oxina.test` (password: `DEMO_PASSWORD` in `prisma/seed.ts`), including `admin@`, `owner@`, `manager.cbe@`, `advisor.cbe@`, `billing.cbe@`, `stock.cbe@`, `sales.cbe@`, `mech1.cbe@`, `qc.cbe@`, `manager.tpr@`, `oem.re@` and portal customers `customer.anand@` / `customer.fathima@`. It drives six service jobs through the real workflow (one closed and paid, one blocked on a part with a procurement date, one awaiting the customer's approval, one in repair, two just received — one at another branch to demonstrate isolation). The seed refuses to run unless `ALLOW_DEMO_SEED=true` and `NODE_ENV` is not `production`.

### Production first run

Never use demo data in production. Create the first Super Admin with the bootstrap command (see [deployment guide §4](docs/DEPLOYMENT.md)).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | Static checks |
| `npm test` | Unit + integration tests (needs `TEST_DATABASE_URL`; that database is wiped) |
| `npm run db:local` | Local development PostgreSQL (embedded binaries) |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | Fictional demo data (development only) |
| `npm run bootstrap:admin` | Create the first Super Admin from `INITIAL_ADMIN_*` env vars (idempotent, locks after use) |
| `npm run worker` | Notification outbox, follow-up reminders, housekeeping |
| `scripts/deploy.sh` / `backup.sh` / `restore.sh` | Release deploy, database + uploads backup/restore on the VPS |

## Tests

`npm test` runs 33 tests on a real PostgreSQL test database, covering all 15 mandatory cases from the brief:

| # | Case | Test |
|---|---|---|
| 1 | Super Admin can access authorized branches | `tests/integration/authorization.test.ts` |
| 2 | Branch A manager cannot access Branch B records | `authorization.test.ts` |
| 3 | Customer cannot access another customer's job | `customer-isolation.test.ts` |
| 4 | Mechanic cannot modify invoices | `authorization.test.ts` |
| 5 | Customers cannot approve others' estimates | `customer-isolation.test.ts` |
| 6 | Concurrent requests cannot over-issue parts | `inventory.test.ts` |
| 7 | No delivery before mandatory QC passes | `workflow.test.ts` |
| 8 | Unavailable parts block dependent tasks | `workflow.test.ts` |
| 9 | Additional chargeable work requires approval | `workflow.test.ts` |
| 10 | Finalized invoices cannot be silently modified | `workflow.test.ts` |
| 11 | Unauthorized users cannot access private file URLs | `customer-isolation.test.ts` |
| 12 | Customer tracking hides internal notes | `customer-isolation.test.ts` |
| 13 | Transfers update both balances correctly | `inventory.test.ts` |
| 14 | ETA responds to delays and part availability | `tests/unit/eta.test.ts` |
| 15 | Branch filters & exports respect authorization | `authorization.test.ts` |

Plus a bootstrap security test and a showroom booking → delivery test (pricing rights, payment gates, invoice = agreed price). Browser end-to-end tests (Playwright) are not yet written; see the status table in [ARCHITECTURE.md](docs/ARCHITECTURE.md#5-implementation-status--what-is-real-simulated-or-future) for what is implemented, simulated, or future work — including that SMS/WhatsApp, payment gateways and the VPS deployment were not exercised in this environment. **Do not treat this as production-ready until the deployment checklist in the deployment guide is complete.**

## Project layout

```
prisma/               schema.prisma, migrations (incl. hand-written constraints/triggers), seed.ts
src/lib/rbac/         permission matrix, Actor & branch scoping
src/lib/auth/         sessions, password hashing, rate limiting
src/lib/services/     business logic (service/, inventory, billing, showroom, people, reports, …)
src/lib/eta/          working-calendar + ETA scheduler (pure)
src/app/api/          route handlers (thin: validate → service → JSON)
src/app/(staff)/      staff application
src/app/portal/       customer portal
scripts/              local postgres, bootstrap, worker, deploy, backup/restore
deploy/               nginx reverse-proxy config, systemd units
tests/                unit + integration tests
```
