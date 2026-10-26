import { cookies } from "next/headers";
import { hasBranch, type Actor } from "@/lib/rbac/actor";

export const BRANCH_COOKIE = "oxina_branch";

/** The branch chosen in the header selector, if the actor may access it. Never trusted blindly. */
export async function selectedBranchId(actor: Actor): Promise<string | undefined> {
  const v = (await cookies()).get(BRANCH_COOKIE)?.value;
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) return undefined;
  return hasBranch(actor, v) ? v : undefined;
}

/** Branch to act in when a page needs exactly one (selected → sole assigned branch). */
export async function workingBranchId(actor: Actor, accessible: { id: string }[]) {
  return (await selectedBranchId(actor)) ?? (accessible.length === 1 ? accessible[0].id : undefined);
}
