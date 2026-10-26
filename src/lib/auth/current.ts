import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadActor, type Actor } from "@/lib/rbac/actor";
import { SESSION_COOKIE, validateSessionToken } from "./session";

/** Resolve the actor for the current request (server components / route handlers). Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await validateSessionToken(token);
  if (!session) return null;
  return loadActor(session.userId);
});

export async function requireStaffPage(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.kind !== "STAFF") redirect("/portal");
  if (actor.mustChangePassword) redirect("/change-password");
  return actor;
}

export async function requireCustomerPage(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.kind !== "CUSTOMER") redirect("/dashboard");
  if (actor.mustChangePassword) redirect("/change-password");
  return actor;
}
