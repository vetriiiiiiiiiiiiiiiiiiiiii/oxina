import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/auth/rate-limit";
import { generateToken, hashToken } from "@/lib/auth/session";
import { currentMeta } from "@/lib/request-context";

const body = z.object({ email: z.string().trim().toLowerCase().email() });

/** Always returns the same response so account existence is not disclosed. */
export const POST = api({ auth: "public", body }, async ({ body }) => {
  await rateLimit(`forgot:${currentMeta().ip ?? "unknown"}`, 5, 15 * 60_000);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user?.isActive) {
    const token = generateToken();
    await prisma.passwordResetToken.create({ data: { id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    const link = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
    await prisma.notificationDelivery.create({
      data: { channel: "EMAIL", recipient: user.email, templateKey: "PASSWORD_RESET", subject: "Reset your Oxina password", body: `Use this link within 30 minutes to reset your password: ${link}\nIf you did not request this, ignore this email.` },
    });
  }
  return { message: "If an account exists for that email, a reset link has been sent." };
});
