import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../fixtures";
import { verifyPassword } from "@/lib/auth/password";

const run = (env: Record<string, string>) => {
  try {
    return { ok: true, out: execFileSync("npx", ["tsx", "scripts/bootstrap-admin.ts"], { env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

describe("Secure first-run bootstrap", () => {
  beforeAll(resetDb);

  it("rejects weak credentials and creates nothing", () => {
    const r = run({ INITIAL_ADMIN_EMAIL: "root@oxina.test", INITIAL_ADMIN_PASSWORD: "password1" });
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/too weak/);
  });

  it("creates exactly one Super Admin who must change the password", async () => {
    expect(await prisma.user.count()).toBe(0);
    const r = run({ INITIAL_ADMIN_EMAIL: "root@oxina.test", INITIAL_ADMIN_PASSWORD: "Bootstrap#Test2026" });
    expect(r.ok).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "root@oxina.test" }, include: { roles: { include: { role: true } } } });
    expect(u.mustChangePassword).toBe(true);
    expect(u.roles.map((x) => x.role.key)).toEqual(["SUPER_ADMIN"]);
    expect(u.passwordHash).not.toContain("Bootstrap#Test2026");
    expect(await verifyPassword(u.passwordHash, "Bootstrap#Test2026")).toBe(true);
  });

  it("is locked after setup: re-running never creates another admin", async () => {
    const r = run({ INITIAL_ADMIN_EMAIL: "intruder@oxina.test", INITIAL_ADMIN_PASSWORD: "Another#Strong2026" });
    expect(r.ok).toBe(true);
    expect(r.out).toMatch(/already completed/);
    expect(await prisma.user.count()).toBe(1);
  });
});
