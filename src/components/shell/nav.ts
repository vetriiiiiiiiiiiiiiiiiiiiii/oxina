import type { PermissionKey } from "@/lib/rbac/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  anyOf: PermissionKey[];
}

/** Sections appear only when the user holds one of the permissions (server-side checks still apply). */
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Daily work", items: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard", anyOf: ["dashboard.group", "dashboard.branch", "service.view", "service.view.assigned", "inventory.view", "showroom.view", "attendance.self"] },
    { href: "/businesses", label: "Branches", icon: "Building2", anyOf: ["org.view"] },
    { href: "/showroom", label: "Showroom", icon: "Store", anyOf: ["showroom.view"] },
    { href: "/vehicles", label: "Vehicles in stock", icon: "Bike", anyOf: ["vehicles.view"] },
    { href: "/inventory", label: "Parts & stock", icon: "Boxes", anyOf: ["inventory.view"] },
    { href: "/service", label: "Service jobs", icon: "Wrench", anyOf: ["service.view", "service.view.assigned"] },
    { href: "/service/board", label: "Workshop board", icon: "KanbanSquare", anyOf: ["service.repair.work", "service.repair.assign"] },
    { href: "/customers", label: "Customers", icon: "Users", anyOf: ["customers.view"] },
  ]},
  { group: "People & accounts", items: [
    { href: "/employees", label: "Employees", icon: "IdCard", anyOf: ["employees.view"] },
    { href: "/attendance", label: "Attendance & targets", icon: "CalendarClock", anyOf: ["attendance.self", "attendance.manage", "targets.view"] },
    { href: "/billing", label: "Billing", icon: "Receipt", anyOf: ["billing.view", "billing.manage"] },
    { href: "/offers", label: "Offers", icon: "TicketPercent", anyOf: ["offers.view"] },
    { href: "/warranty", label: "Warranty claims", icon: "ShieldCheck", anyOf: ["warranty.view"] },
  ]},
  { group: "Admin", items: [
    { href: "/reports", label: "Reports", icon: "BarChart3", anyOf: ["reports.view"] },
    { href: "/notifications", label: "Inbox", icon: "Bell", anyOf: ["attendance.self", "service.view", "service.view.assigned", "inventory.view", "showroom.view", "reports.view", "warranty.view", "org.view"] },
    { href: "/audit", label: "Audit log", icon: "ScrollText", anyOf: ["audit.view"] },
    { href: "/settings", label: "Settings", icon: "Settings", anyOf: ["users.view", "settings.manage", "notifications.templates.manage"] },
  ]},
];
