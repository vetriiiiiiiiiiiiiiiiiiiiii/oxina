import type { Actor } from "@/lib/rbac/actor";
import type { PermissionKey } from "@/lib/rbac/permissions";

interface NavItem {
  href: string;
  label: string;
  /** Shown when the user holds any of these. Read-only access granted for lookups (e.g. an advisor
   *  checking stock from a job) does not put a whole module in their menu. */
  anyOf: PermissionKey[];
}

const GROUPS: { group: string; items: NavItem[] }[] = [
  { group: "Workshop", items: [
    { href: "/service", label: "Service jobs", anyOf: ["service.job.create", "service.job.manage", "service.view.assigned", "service.quality.inspect", "billing.manage"] },
    { href: "/service/board", label: "Workshop board", anyOf: ["service.repair.work", "service.repair.assign"] },
    { href: "/service/followups", label: "Follow-up calls", anyOf: ["followups.manage"] },
  ]},
  { group: "Showroom", items: [
    { href: "/showroom", label: "Leads & bookings", anyOf: ["showroom.leads.manage", "showroom.bookings.manage", "showroom.pricing.approve"] },
    { href: "/vehicles", label: "Vehicles in stock", anyOf: ["vehicles.manage", "showroom.leads.manage", "vehicles.cost.view"] },
    { href: "/offers", label: "Offers", anyOf: ["offers.manage", "showroom.leads.manage"] },
  ]},
  { group: "Parts", items: [
    { href: "/inventory", label: "Stock", anyOf: ["inventory.manage", "inventory.issue", "purchases.approve", "inventory.cost.view"] },
    { href: "/inventory/requests", label: "Workshop requests", anyOf: ["inventory.issue"] },
    { href: "/inventory/purchases", label: "Purchases", anyOf: ["purchases.manage", "purchases.approve"] },
  ]},
  { group: "Customers & money", items: [
    { href: "/customers", label: "Customers", anyOf: ["customers.manage", "dashboard.group"] },
    { href: "/billing", label: "Billing", anyOf: ["billing.manage", "payments.confirm", "billing.credit_note", "dashboard.group", "expenses.approve"] },
    { href: "/warranty", label: "Warranty claims", anyOf: ["warranty.manage", "warranty.view"] },
  ]},
  { group: "People", items: [
    { href: "/employees", label: "Staff", anyOf: ["employees.manage", "attendance.manage", "dashboard.group"] },
    { href: "/attendance", label: "Attendance & targets", anyOf: ["attendance.self", "attendance.manage", "targets.manage"] },
  ]},
  { group: "Admin", items: [
    { href: "/reports", label: "Reports", anyOf: ["reports.view"] },
    { href: "/audit", label: "Audit log", anyOf: ["audit.view"] },
    { href: "/settings", label: "Settings", anyOf: ["users.manage", "settings.manage", "settings.durations", "notifications.templates.manage"] },
  ]},
];

/** The menu for one person: their role's work areas only, in department order. */
export function buildNav(actor: Actor, branches: { id: string; name: string }[]) {
  const has = (p: PermissionKey) => actor.permissions.has(p);
  const groups = GROUPS.map((g) => ({ group: g.group, items: g.items.filter((i) => i.anyOf.some(has)).map(({ href, label }) => ({ href, label, icon: "" })) }));

  // Branch link: the group-wide list for admins/owners, "My branch" for a single-branch manager.
  const admin = groups.find((g) => g.group === "Admin")!;
  if (has("org.manage") || (has("org.view") && (actor.allBranches || branches.length > 1))) admin.items.unshift({ href: "/businesses", label: "Branches", icon: "" });
  else if (has("org.view") && branches.length === 1) admin.items.unshift({ href: `/businesses/branches/${branches[0].id}`, label: "My branch", icon: "" });

  const home = has("dashboard.group") || has("dashboard.branch") ? "Overview" : "My work";
  return [
    { group: "", items: [{ href: "/dashboard", label: home, icon: "" }, { href: "/notifications", label: "Inbox", icon: "" }] },
    ...groups.filter((g) => g.items.length),
  ];
}
