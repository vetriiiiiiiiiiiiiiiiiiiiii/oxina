import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { SESSION_COOKIE, invalidateSession } from "@/lib/auth/session";

export const POST = api({ auth: "public" }, async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  const res = NextResponse.json({ ok: true, data: { redirect: "/login" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
