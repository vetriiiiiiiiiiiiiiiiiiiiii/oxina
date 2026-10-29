/**
 * Background worker (run as its own container/process: `npm run worker`).
 *
 * Jobs:
 *  1. Outbox delivery — sends queued NotificationDelivery rows. Claims rows with
 *     FOR UPDATE SKIP LOCKED so several workers can run safely. Email goes through SMTP
 *     when SMTP_HOST is set; otherwise rows are marked SKIPPED_NO_PROVIDER (never "sent").
 *     SMS / WhatsApp are not integrated in this release and are skipped the same way.
 *     "SENT" means the SMTP server accepted the message; "DELIVERED" is only set by a
 *     provider delivery confirmation, which plain SMTP does not give.
 *  2. Follow-up reminders — notifies the assigned staff member when a follow-up becomes due.
 *  3. Housekeeping — removes expired sessions, used reset tokens and old rate-limit rows.
 *  4. Completion times — recalculates the ETA of open jobs every few minutes, because time passing
 *     (closing hours, a part's expected date going by) changes it even when nobody touches the job.
 */
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

const prisma = new PrismaClient();
const MAX_ATTEMPTS = 5;
const smtp = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    })
  : null;

async function deliverBatch() {
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "NotificationDelivery" SET "status" = 'SENDING', "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "NotificationDelivery"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" LIMIT 20 FOR UPDATE SKIP LOCKED
    ) RETURNING "id"`;
  for (const { id } of claimed) {
    const d = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    if (d.channel !== "EMAIL" || !smtp) {
      await prisma.notificationDelivery.update({ where: { id }, data: { status: "SKIPPED_NO_PROVIDER", lastError: d.channel === "EMAIL" ? "SMTP not configured" : `${d.channel} provider not integrated` } });
      continue;
    }
    try {
      const info = await smtp.sendMail({ from: process.env.SMTP_FROM, to: d.recipient, subject: d.subject ?? "Oxina Groups", text: d.body });
      await prisma.notificationDelivery.update({ where: { id }, data: { status: "SENT", providerMessageId: info.messageId, sentAt: new Date(), lastError: null } });
    } catch (e) {
      const failed = d.attempts >= MAX_ATTEMPTS;
      await prisma.notificationDelivery.update({
        where: { id },
        data: { status: failed ? "FAILED" : "QUEUED", lastError: String((e as Error).message).slice(0, 500), nextAttemptAt: new Date(Date.now() + 2 ** d.attempts * 60_000) },
      });
    }
  }
  return claimed.length;
}

async function followUpReminders() {
  // Notify once per due follow-up: the reminder is keyed by follow-up id in the notification link.
  const due = await prisma.followUp.findMany({ where: { status: "PENDING", dueAt: { lte: new Date() }, assignedToId: { not: null } }, take: 100, include: { customer: { select: { fullName: true } } } });
  for (const f of due) {
    const link = `/service/followups?due=overdue#${f.id}`;
    const exists = await prisma.notification.findFirst({ where: { userId: f.assignedToId!, link, createdAt: { gte: f.dueAt } } });
    if (exists) continue;
    await prisma.notification.create({ data: { userId: f.assignedToId!, branchId: f.branchId, type: "FOLLOW_UP_DUE", title: `Follow-up due: ${f.customer.fullName}`, body: f.type.replace(/_/g, " ").toLowerCase(), link } });
  }
}

async function refreshEtas() {
  const { recalcEta } = await import("../src/lib/services/service/eta");
  const stale = await prisma.serviceJob.findMany({
    where: { status: { notIn: ["READY_FOR_DELIVERY", "DELIVERED", "CLOSED", "CANCELLED"] }, OR: [{ etaUpdatedAt: null }, { etaUpdatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
    select: { id: true },
    take: 200,
  });
  for (const j of stale) await prisma.$transaction((tx) => recalcEta(tx, j.id)).catch((e) => console.error("[worker] eta", j.id, e));
}

async function housekeeping() {
  const now = new Date();
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 24 * 3600_000) } } });
}

let stopping = false;
async function loop() {
  console.log(`[worker] started (email: ${smtp ? "SMTP" : "not configured — deliveries will be SKIPPED_NO_PROVIDER"})`);
  let tick = 0;
  while (!stopping) {
    try {
      const n = await deliverBatch();
      if (tick % 6 === 0) await followUpReminders();
      if (tick % 30 === 0) await refreshEtas();
      if (tick % 360 === 0) await housekeeping();
      tick++;
      if (n === 0) await new Promise((r) => setTimeout(r, 10_000));
    } catch (e) {
      console.error("[worker] error", e);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  await prisma.$disconnect();
}

for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => (stopping = true));
loop();
