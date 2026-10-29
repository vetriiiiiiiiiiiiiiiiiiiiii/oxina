/**
 * Role–permission matrix. This file is the source of truth: `prisma/seed.ts` and
 * `scripts/bootstrap-admin.ts` sync it into the Role / Permission tables, and every
 * protected server operation checks against the permissions loaded from the database.
 */
import type { RoleScope } from "@prisma/client";

export const PERMISSIONS = {
  // Organisation
  "org.view": "View business units and branches",
  "org.manage": "Create, edit and deactivate business units and branches",
  "dashboard.group": "View the consolidated group dashboard",
  "dashboard.branch": "View branch dashboards",
  "users.view": "View staff user accounts",
  "users.manage": "Create, deactivate users and assign roles/branches",
  "settings.manage": "Configure branch operating policies",
  "settings.durations": "Configure repair duration standards",
  "audit.view": "View audit logs",
  // Showroom
  "showroom.view": "View leads, quotations and bookings",
  "showroom.leads.manage": "Create and update leads and follow-ups",
  "showroom.quotations.manage": "Prepare quotations",
  "showroom.bookings.manage": "Create and progress bookings and deliveries",
  "showroom.pricing.approve": "Approve discounts, change pricing and finalize sales",
  "vehicles.view": "View showroom vehicle inventory",
  "vehicles.manage": "Add and update showroom vehicles",
  "vehicles.cost.view": "View vehicle purchase cost",
  "offers.view": "View offers and coupons",
  "offers.manage": "Create and manage offers and coupons",
  // Inventory
  "inventory.view": "View spare-part inventory",
  "inventory.manage": "Receive, adjust and audit stock",
  "inventory.issue": "Pick and issue parts against requests",
  "inventory.transfer": "Create and process inter-branch transfers",
  "inventory.cost.view": "View purchase cost of parts",
  "purchases.manage": "Create purchase orders and goods receipts",
  "purchases.approve": "Approve purchase orders",
  "suppliers.manage": "Manage suppliers",
  // Service
  "service.view": "View all service jobs in scope",
  "service.view.assigned": "View service jobs assigned to me",
  "service.job.create": "Register vehicles and create service jobs",
  "service.job.manage": "Update jobs, assign staff, cancel jobs",
  "service.inspect": "Perform inspections and diagnosis",
  "service.estimate.manage": "Prepare estimates and send for approval",
  "service.estimate.record_approval": "Record customer approval given in person or by phone",
  "service.discount.approve": "Approve discounts above the configured limit",
  "service.parts.request": "Request spare parts for a job",
  "service.repair.assign": "Assign mechanics to tasks",
  "service.repair.work": "Start, pause, complete assigned repair tasks",
  "service.quality.inspect": "Perform quality inspections and test rides",
  "service.handover": "Mark ready for delivery and hand over vehicles",
  "followups.manage": "Record post-service follow-ups",
  // Customers
  "customers.view": "View customers",
  "customers.manage": "Create and update customers",
  "customers.sensitive.view": "View and download sensitive customer documents",
  // People
  "employees.view": "View employees",
  "employees.manage": "Create and update employees",
  "attendance.self": "Clock in/out and apply for leave",
  "attendance.manage": "Review attendance, corrections and leave",
  "targets.view": "View targets and performance",
  "targets.manage": "Set employee targets",
  // Finance
  "billing.view": "View invoices and payments",
  "billing.manage": "Prepare and finalize invoices",
  "billing.credit_note": "Issue credit notes and cancel invoices",
  "payments.record": "Record payments",
  "payments.confirm": "Confirm payments and issue receipts",
  "refunds.approve": "Approve refunds",
  "expenses.submit": "Submit expenses",
  "expenses.approve": "Approve expenses",
  // Warranty & reports
  "warranty.view": "View warranties and claims",
  "warranty.manage": "Create and progress warranty claims",
  "reports.view": "View reports",
  "reports.export": "Export reports as CSV",
  "notifications.templates.manage": "Edit notification templates",
  // Customer portal
  "portal.access": "Access own customer portal",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

export interface RoleDef {
  key: string;
  name: string;
  scope: RoleScope;
  description: string;
  permissions: PermissionKey[];
}

export const ROLES: RoleDef[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super Admin",
    scope: "GROUP",
    description: "Oxina Groups administrator with access to every business unit and branch.",
    permissions: ALL.filter((p) => p !== "portal.access" && p !== "service.view.assigned"),
  },
  {
    key: "GROUP_OWNER",
    name: "Group Owner",
    scope: "BUSINESS_UNIT",
    description: "Oversees assigned business units: performance, approvals and reports.",
    permissions: [
      "org.view", "dashboard.group", "dashboard.branch", "users.view", "audit.view",
      "showroom.view", "vehicles.view", "vehicles.cost.view", "offers.view",
      "inventory.view", "inventory.cost.view", "purchases.approve",
      "service.view", "customers.view", "employees.view", "targets.view", "targets.manage",
      "billing.view", "expenses.approve", "refunds.approve", "warranty.view",
      "reports.view", "reports.export",
    ],
  },
  {
    key: "BRANCH_MANAGER",
    name: "Branch Manager",
    scope: "BRANCH",
    description: "Runs assigned branches: staff, service, stock, approvals within limits.",
    permissions: [
      "org.view", "dashboard.branch", "users.view", "audit.view",
      "showroom.view", "showroom.leads.manage", "showroom.quotations.manage", "showroom.bookings.manage", "showroom.pricing.approve",
      "vehicles.view", "vehicles.manage", "vehicles.cost.view", "offers.view", "offers.manage",
      "inventory.view", "inventory.manage", "inventory.issue", "inventory.transfer", "inventory.cost.view",
      "purchases.manage", "purchases.approve", "suppliers.manage",
      "service.view", "service.job.create", "service.job.manage", "service.inspect", "service.estimate.manage",
      "service.estimate.record_approval", "service.discount.approve", "service.parts.request", "service.repair.assign",
      "service.quality.inspect", "service.handover", "followups.manage",
      "customers.view", "customers.manage", "customers.sensitive.view",
      "employees.view", "employees.manage", "attendance.self", "attendance.manage", "targets.view", "targets.manage",
      "billing.view", "billing.manage", "billing.credit_note", "payments.record", "payments.confirm", "refunds.approve",
      "expenses.submit", "expenses.approve", "warranty.view", "warranty.manage", "reports.view", "reports.export",
      "settings.durations",
    ],
  },
  // Department managers: run one area of a branch and see nothing outside it.
  {
    key: "SERVICE_MANAGER",
    name: "Service Manager",
    scope: "BRANCH",
    description: "Runs the workshop: jobs, mechanics, quality, service customers and parts requests.",
    permissions: [
      "org.view", "dashboard.branch",
      "service.view", "service.job.create", "service.job.manage", "service.inspect", "service.estimate.manage",
      "service.estimate.record_approval", "service.discount.approve", "service.parts.request", "service.repair.assign",
      "service.quality.inspect", "service.handover", "followups.manage", "settings.durations",
      "customers.view", "customers.manage", "inventory.view", "warranty.view", "warranty.manage",
      "billing.view", "employees.view", "attendance.self", "attendance.manage", "targets.view", "targets.manage",
      "reports.view", "reports.export", "expenses.submit",
    ],
  },
  {
    key: "SHOWROOM_MANAGER",
    name: "Showroom Manager",
    scope: "BRANCH",
    description: "Runs vehicle sales: leads, pricing approvals, bookings, deliveries and offers.",
    permissions: [
      "org.view", "dashboard.branch",
      "showroom.view", "showroom.leads.manage", "showroom.quotations.manage", "showroom.bookings.manage", "showroom.pricing.approve",
      "vehicles.view", "vehicles.manage", "vehicles.cost.view", "offers.view", "offers.manage",
      "customers.view", "customers.manage", "customers.sensitive.view",
      "billing.view", "payments.record", "payments.confirm",
      "employees.view", "attendance.self", "attendance.manage", "targets.view", "targets.manage",
      "reports.view", "reports.export", "expenses.submit",
    ],
  },
  {
    key: "STORES_MANAGER",
    name: "Stores Manager",
    scope: "BRANCH",
    description: "Runs spare-parts stock: purchasing, approvals, transfers, counts and workshop issues.",
    permissions: [
      "org.view", "dashboard.branch",
      "inventory.view", "inventory.manage", "inventory.issue", "inventory.transfer", "inventory.cost.view",
      "purchases.manage", "purchases.approve", "suppliers.manage", "service.view",
      "employees.view", "attendance.self", "attendance.manage", "targets.view", "targets.manage",
      "reports.view", "reports.export", "expenses.submit",
    ],
  },
  {
    key: "SALES_EXECUTIVE",
    name: "Showroom Sales Executive",
    scope: "BRANCH",
    description: "Leads, test rides, quotations and bookings.",
    permissions: [
      "showroom.view", "showroom.leads.manage", "showroom.quotations.manage", "showroom.bookings.manage",
      "vehicles.view", "offers.view", "customers.view", "customers.manage", "payments.record",
      "attendance.self", "targets.view", "expenses.submit",
    ],
  },
  {
    key: "WAREHOUSE_EXECUTIVE",
    name: "Stock / Warehouse Executive",
    scope: "BRANCH",
    description: "Receipts, issues, transfers, suppliers and purchase orders.",
    permissions: [
      "inventory.view", "inventory.manage", "inventory.issue", "inventory.transfer", "inventory.cost.view",
      "purchases.manage", "suppliers.manage", "service.view", "attendance.self", "targets.view", "expenses.submit",
    ],
  },
  {
    key: "SERVICE_ADVISOR",
    name: "Service Advisor / Examiner",
    scope: "BRANCH",
    description: "Vehicle reception, inspection, estimates and customer communication.",
    permissions: [
      "service.view", "service.job.create", "service.job.manage", "service.inspect", "service.estimate.manage",
      "service.estimate.record_approval", "service.parts.request", "service.repair.assign", "service.handover",
      "followups.manage", "customers.view", "customers.manage", "inventory.view", "warranty.view", "warranty.manage",
      "attendance.self", "targets.view",
    ],
  },
  {
    key: "BILLING_EXECUTIVE",
    name: "Billing Executive",
    scope: "BRANCH",
    description: "Estimates, invoices, parts verification and payments.",
    permissions: [
      "service.view", "service.estimate.manage", "service.parts.request", "inventory.view",
      "billing.view", "billing.manage", "payments.record", "payments.confirm", "customers.view",
      "attendance.self", "targets.view",
    ],
  },
  {
    key: "MECHANIC",
    name: "Mechanic / Technician",
    scope: "BRANCH",
    description: "Works on assigned repair tasks.",
    permissions: ["service.view.assigned", "service.repair.work", "service.parts.request", "attendance.self", "targets.view"],
  },
  {
    key: "QUALITY_INSPECTOR",
    name: "Quality Inspector / Test Ride",
    scope: "BRANCH",
    description: "Quality checks and test rides.",
    permissions: ["service.view", "service.quality.inspect", "attendance.self", "targets.view"],
  },
  {
    key: "OEM_REPRESENTATIVE",
    name: "OEM Representative",
    scope: "BUSINESS_UNIT",
    description: "Manufacturer representative limited to warranty records of assigned brands.",
    permissions: ["warranty.view", "reports.view"],
  },
  {
    key: "CUSTOMER",
    name: "Customer",
    scope: "SELF",
    description: "Customer portal user.",
    permissions: ["portal.access"],
  },
];

export const STAFF_ROLE_KEYS = ROLES.filter((r) => r.key !== "CUSTOMER").map((r) => r.key);
