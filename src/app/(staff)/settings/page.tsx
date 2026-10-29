import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { workingBranchId } from "@/lib/branch-context";
import { accessibleBranches, listUsers, roleMatrix } from "@/lib/services/org";
import { listDeliveries } from "@/lib/services/misc";
import { BRANCH_SETTING_DEFAULTS, getBranchSetting, type BranchSettingKey } from "@/lib/services/settings";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/templates";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtDateTime } from "@/lib/utils";
import { ResetLink, SettingEditor } from "./client";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireStaffPage();
  const show = {
    users: can(actor, "users.manage"),
    roles: can(actor, "users.manage") && actor.allBranches,
    policies: can(actor, "settings.manage"),
    durations: can(actor, "settings.durations"),
    templates: can(actor, "notifications.templates.manage"),
  };
  if (!Object.values(show).some(Boolean)) throw forbidden();
  const requested = (await searchParams).tab;
  const tabs = [
    ...(show.users ? [{ key: "users", label: "Users & access", href: "?tab=users" }] : []),
    ...(show.roles ? [{ key: "roles", label: "Role permissions", href: "?tab=roles" }] : []),
    ...(show.policies ? [{ key: "policies", label: "Branch policies", href: "?tab=policies" }] : []),
    ...(show.durations ? [{ key: "durations", label: "Repair durations", href: "?tab=durations" }] : []),
    ...(show.templates ? [{ key: "templates", label: "Message templates", href: "?tab=templates" }] : []),
  ];
  // Never render a tab the person isn't allowed, even if typed into the URL.
  const tab = tabs.some((t) => t.key === requested) ? requested! : tabs[0].key;
  const branches = await accessibleBranches(actor, true);
  const wb = await workingBranchId(actor, branches.filter((b) => b.isActive));
  return (
    <>
      <PageHeader title="Settings" />
      <LinkTabs active={tab} tabs={tabs} />
      {tab === "users" && <Users />}
      {tab === "roles" && <Roles />}
      {tab === "policies" && <Policies />}
      {tab === "durations" && <Durations />}
      {tab === "templates" && <Templates />}
    </>
  );

  async function Users() {
    const [users, roles, units] = await Promise.all([listUsers(actor, {}), roleMatrix(), prisma.businessUnit.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })]);
    const grantable = roles.filter((r) => r.key !== "CUSTOMER" && r.permissions.every((p) => actor.permissions.has(p.permission.key)) && (actor.allBranches || r.scope === "BRANCH"));
    return (
      <Card>
        <CardHeader title="Staff accounts" description="New users must change their temporary password at first sign-in. Deactivation ends all sessions immediately; history is preserved."
          action={can(actor, "users.manage") && <Modal trigger="New user" title="Create staff user" triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/admin/users" successMessage="User created. Share the temporary password securely." fields={[{ name: "name", label: "Full name", required: true }, { name: "email", label: "Work email", type: "email", required: true }, { name: "username", label: "Username (optional)" }, { name: "phone", label: "Phone" }, { name: "temporaryPassword", label: "Temporary password", type: "password", required: true, hint: "12+ chars, upper/lower case, number, symbol" }, { name: "roleKeys", label: "Roles", type: "multiselect", required: true, options: grantable.map((r) => ({ value: r.key, label: `${r.name} (${r.scope.toLowerCase().replace("_", " ")})` })) }, { name: "branchIds", label: "Branches", type: "multiselect", options: branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name })) }, ...(actor.allBranches ? [{ name: "businessUnitIds", label: "Business units (owners / OEM reps)", type: "multiselect" as const, options: units.map((u) => ({ value: u.id, label: u.name })) }] : [])]} /></Modal>} />
        {users.length ? (
          <Table>
            <thead><tr><Th>User</Th><Th>Roles</Th><Th>Branches / units</Th><Th>Last sign-in</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <Td><span className="font-medium">{u.name}</span><div className="text-xs text-muted">{u.email}{u.employee ? ` · ${u.employee.employeeCode}` : ""}</div></Td>
                <Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.role.key}>{r.role.name}</Badge>)}</div></Td>
                <Td className="text-xs">{[...u.branchAssignments.map((b) => b.branch.name), ...u.businessUnitAssignments.map((b) => `${b.businessUnit.name} (unit)`)].join(", ") || (u.roles.some((r) => r.role.key === "SUPER_ADMIN") ? "All (group)" : "—")}</Td>
                <Td className="text-xs">{fmtDateTime(u.lastLoginAt)}{u.mustChangePassword && <div className="text-warn-700">must change password</div>}</Td>
                <Td><StatusBadge status={u.isActive ? "ACTIVE" : "CANCELLED"} label={u.isActive ? "active" : "deactivated"} /></Td>
                <Td>{can(actor, "users.manage") && u.id !== actor.userId && <div className="flex flex-wrap gap-2">
                  <Modal trigger="Access" title={`Access for ${u.name}`} wide><SimpleForm url={`/api/admin/users/${u.id}`} method="PATCH" successMessage="Access updated; user's sessions were ended." fields={[{ name: "roleKeys", label: "Roles", type: "multiselect", required: true, defaultValue: u.roles.map((r) => r.role.key) as unknown as string, options: grantable.map((r) => ({ value: r.key, label: r.name })) }, { name: "branchIds", label: "Branches", type: "multiselect", defaultValue: u.branchAssignments.map((b) => b.branch.id) as unknown as string, options: branches.map((b) => ({ value: b.id, label: b.name })) }]} /></Modal>
                  <ResetLink userId={u.id} />
                  <ActionButton size="sm" variant="ghost" url={`/api/admin/users/${u.id}`} method="PATCH" body={{ isActive: !u.isActive }} confirm={u.isActive ? `Deactivate ${u.name}? They are signed out immediately.` : undefined} success="Updated.">{u.isActive ? "Deactivate" : "Reactivate"}</ActionButton>
                </div>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No users" />}
      </Card>
    );
  }

  async function Roles() {
    const roles = await roleMatrix();
    const keys = Object.keys(PERMISSIONS);
    return (
      <Card>
        <CardHeader title="Role–permission matrix" description="Defined in src/lib/rbac/permissions.ts and enforced on every server operation. Scope: group = all branches, business unit = branches of assigned units, branch = assigned branches, self = own records." />
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="sticky left-0 bg-white px-3 py-2 text-left">Permission</th>{roles.map((r) => <th key={r.id} className="px-2 py-2 align-bottom"><div className="w-6 origin-bottom-left translate-x-3 -rotate-60 whitespace-nowrap text-left font-medium">{r.name}</div></th>)}</tr></thead>
            <tbody>{keys.map((k) => <tr key={k} className="border-t border-line/60"><td className="sticky left-0 bg-white px-3 py-1.5" title={PERMISSIONS[k as keyof typeof PERMISSIONS]}><span className="font-mono">{k}</span></td>{roles.map((r) => <td key={r.id} className="px-2 text-center">{r.permissions.some((p) => p.permission.key === k) ? <span className="text-ok-600">●</span> : <span className="text-line">·</span>}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Card>
    );
  }

  async function Policies() {
    if (!wb) return <Notice tone="warn">Select a branch in the header to edit its policies.</Notice>;
    const branch = branches.find((b) => b.id === wb)!;
    const entries = await Promise.all((Object.keys(BRANCH_SETTING_DEFAULTS) as BranchSettingKey[]).map(async (k) => [k, await getBranchSetting(prisma, wb, k)] as const));
    return (
      <Card>
        <CardHeader title={`Operational policies — ${branch.name}`} description="Branch values override business-unit values, which override built-in defaults." />
        <ul className="divide-y divide-line">{entries.map(([k, v]) => <li key={k} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><span className="font-mono text-xs">{k}</span><SettingEditor branchId={wb} settingKey={k} value={v as never} /></li>)}</ul>
      </Card>
    );
  }

  async function Durations() {
    const unitIds = [...new Set(branches.map((b) => b.businessUnitId))];
    const rows = await prisma.repairDurationStandard.findMany({ where: { businessUnitId: { in: unitIds }, OR: [{ branchId: null }, ...(actor.allBranches ? [{}] : [{ branchId: { in: actor.branchIds } }])] }, include: { branch: { select: { name: true } }, vehicleModel: { select: { name: true } }, businessUnit: { select: { name: true } } }, orderBy: [{ taskKey: "asc" }] });
    const branch = branches.find((b) => b.id === wb);
    const models = branch ? await prisma.vehicleModel.findMany({ where: { businessUnitId: branch.businessUnitId } }) : [];
    return (
      <Card>
        <CardHeader title="Repair duration standards" description="Demonstration defaults, not guaranteed times. Most specific wins: branch + model → branch → model → unit default. Used by the ETA engine."
          action={branch && <Modal trigger="Set duration" title={`Duration override — ${branch.name}`}><SimpleForm url="/api/settings/durations" method="PUT" fixed={{ businessUnitId: branch.businessUnitId, branchId: branch.id }} fields={[{ name: "taskKey", label: "Task key", type: "select", required: true, options: [...new Map(rows.map((r) => [r.taskKey, r.label])).entries()].map(([value, label]) => ({ value, label })) }, { name: "label", label: "Label", required: true }, { name: "vehicleModelId", label: "Model (optional)", type: "select", options: models.map((m) => ({ value: m.id, label: `${m.name} ${m.variant}` })) }, { name: "minMinutes", label: "Min minutes", type: "number", required: true }, { name: "maxMinutes", label: "Max minutes", type: "number", required: true }, { name: "defaultLabour", label: "Default labour (₹)", type: "number" }]} /></Modal>} />
        <Table><thead><tr><Th>Task</Th><Th>Scope</Th><Th className="text-right">Min</Th><Th className="text-right">Max</Th><Th className="text-right">Default labour</Th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><Td>{r.label}<div className="font-mono text-[10px] text-faint">{r.taskKey}</div></Td><Td className="text-xs">{r.businessUnit.name}{r.branch ? ` · ${r.branch.name}` : " · default"}{r.vehicleModel ? ` · ${r.vehicleModel.name}` : ""}</Td><Td className="text-right">{r.minMinutes} min</Td><Td className="text-right">{r.maxMinutes} min</Td><Td className="text-right">₹{Number(r.defaultLabour)}</Td></tr>)}</tbody>
        </Table>
      </Card>
    );
  }

  async function Templates() {
    const [custom, deliveries] = await Promise.all([prisma.notificationTemplate.findMany({ where: { businessUnitId: null, channel: "EMAIL" } }), listDeliveries(actor)]);
    return (
      <div className="space-y-6">
        <Notice>Placeholders such as {"{{customer_name}}"} are filled from database records when a message is queued. Missing values render as “—”, never invented. Email sends only when SMTP is configured; SMS/WhatsApp providers are not integrated in this release.</Notice>
        <Card>
          <CardHeader title="Email templates" />
          <ul className="divide-y divide-line">{DEFAULT_TEMPLATES.map((d) => {
            const t = custom.find((c) => c.key === d.key);
            return (
              <li key={d.key} className="px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{d.key}</span><Modal trigger="Edit" title={`Template ${d.key}`} wide><SimpleForm url={`/api/notifications/templates/${d.key}`} method="PUT" columns={1} fields={[{ name: "subject", label: "Subject", defaultValue: t?.subject ?? d.subject ?? "" }, { name: "body", label: "Body", type: "textarea", required: true, defaultValue: t?.body ?? d.body }, { name: "isActive", label: "Active", type: "checkbox", defaultValue: t?.isActive ?? true }]} /></Modal></div>
                <p className="mt-1 font-medium">{t?.subject ?? d.subject}</p>
                <p className="text-muted">{t?.body ?? d.body}</p>
              </li>
            );
          })}</ul>
        </Card>
        <Card>
          <CardHeader title="Recent external deliveries" description="Status comes from the worker/provider. 'Sent' = accepted by SMTP server; 'Delivered' only with provider confirmation." />
          {deliveries.length ? <Table><thead><tr><Th>Queued</Th><Th>Template</Th><Th>Channel</Th><Th>Recipient</Th><Th>Status</Th><Th>Attempts</Th></tr></thead><tbody>{deliveries.map((d) => <tr key={d.id}><Td className="text-xs">{fmtDateTime(d.createdAt)}</Td><Td className="font-mono text-xs">{d.templateKey}</Td><Td className="text-xs">{d.channel}</Td><Td className="text-xs">{d.recipient.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}</Td><Td><StatusBadge status={d.status} /></Td><Td className="text-xs">{d.attempts}{d.lastError ? ` · ${d.lastError.slice(0, 60)}` : ""}</Td></tr>)}</tbody></Table> : <EmptyState title="Nothing queued" />}
        </Card>
      </div>
    );
  }
}
