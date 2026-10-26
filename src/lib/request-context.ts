import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestMeta>();
export const currentMeta = (): RequestMeta => requestContext.getStore() ?? { ip: null, userAgent: null };

export function metaFromHeaders(h: Headers): RequestMeta {
  // Behind Nginx the client address is the first X-Forwarded-For hop (Nginx overwrites it — see deploy/nginx).
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: fwd || h.get("x-real-ip") || null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}
