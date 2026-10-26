import type { NextRequest } from "next/server";
import { getActor } from "@/lib/auth/current";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/api";
import { unauthenticated } from "@/lib/errors";
import { bus, jobChannel } from "@/lib/realtime";
import { getJobForActor } from "@/lib/services/service/common";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: emits `update` whenever the job changes. Pushed immediately from this
 * instance's event bus, and verified by a 5-second database check so updates made by other
 * app instances also arrive. Clients fall back to polling if SSE is unavailable.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) throw unauthenticated();
    const { id } = await ctx.params;
    await getJobForActor(actor, id);
    const enc = new TextEncoder();
    let last = "";
    let closed = false;
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const check = async () => {
          const j = await prisma.serviceJob.findUnique({ where: { id }, select: { version: true, updatedAt: true } }).catch(() => null);
          // Any workflow step touches the job row (status, version or ETA), so updatedAt is a reliable change marker.
          const mark = j ? `${j.version}:${j.updatedAt.getTime()}` : "";
          if (j && mark !== last) {
            if (last) send("update", { version: j.version });
            last = mark;
          }
        };
        const onBus = () => void check();
        bus.on(jobChannel(id), onBus);
        void check();
        const poll = setInterval(check, 5000);
        const ping = setInterval(() => !closed && controller.enqueue(enc.encode(`: ping\n\n`)), 15000);
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(poll);
          clearInterval(ping);
          bus.off(jobChannel(id), onBus);
          try { controller.close(); } catch {}
        };
        req.signal.addEventListener("abort", close);
        send("ready", { ok: true });
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
