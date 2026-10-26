import { EventEmitter } from "node:events";

/**
 * In-process pub/sub used to push service-job updates to SSE subscribers immediately.
 * With multiple app containers each instance only sees its own events; the SSE endpoint
 * therefore also polls the database every few seconds, so every client converges.
 */
const g = globalThis as unknown as { __oxinaBus?: EventEmitter };
export const bus = g.__oxinaBus ?? (g.__oxinaBus = new EventEmitter().setMaxListeners(1000));

export const jobChannel = (jobId: string) => `job:${jobId}`;
export const publishJobUpdate = (jobId: string) => bus.emit(jobChannel(jobId), { jobId, at: Date.now() });
