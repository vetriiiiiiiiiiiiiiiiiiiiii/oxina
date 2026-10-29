import { requireStaffPage } from "@/lib/auth/current";
import { accessibleBranches } from "@/lib/services/org";
import { selectedBranchId } from "@/lib/branch-context";
import { unreadCount } from "@/lib/services/misc";
import { AppShell } from "@/components/shell/sidebar";
import { buildNav } from "@/components/shell/nav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffPage();
  const [branches, selected, unread] = await Promise.all([accessibleBranches(actor), selectedBranchId(actor), unreadCount(actor)]);
  const nav = buildNav(actor, branches);
  return (
    <AppShell nav={nav} user={{ name: actor.name, email: actor.email, roles: actor.roles }} branches={branches} selected={selected ?? null} unread={unread} allBranches={actor.allBranches}>
      {children}
    </AppShell>
  );
}
