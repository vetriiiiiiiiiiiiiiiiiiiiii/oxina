import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { AppError, forbidden, unauthenticated } from "@/lib/errors";
import { getActor } from "@/lib/auth/current";
import type { Actor } from "@/lib/rbac/actor";
import { metaFromHeaders, requestContext } from "@/lib/request-context";

export type ApiOk<T> = { ok: true; data: T; meta?: Record<string, unknown> };
export type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };

type Auth = "staff" | "customer" | "any" | "public";

interface Options<B, Q> {
  auth?: Auth;
  // Third type arg = raw input; B/Q are inferred from the parsed output (defaults applied).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: ZodType<B, ZodTypeDef, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query?: ZodType<Q, ZodTypeDef, any>;
}

interface Ctx<B, Q> {
  req: NextRequest;
  actor: Actor;
  body: B;
  query: Q;
  params: Record<string, string>;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** CSRF defence for cookie-authenticated mutations: require a same-origin Origin header. */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) throw forbidden("Missing request origin.");
  const allowed = new Set<string>();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (host) allowed.add(`${proto}://${host}`);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  if (!allowed.has(origin)) throw forbidden("Cross-origin request rejected.");
}

export function toErrorResponse(e: unknown) {
  if (e instanceof AppError) {
    return NextResponse.json<ApiErr>({ ok: false, error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json<ApiErr>(
      { ok: false, error: { code: "VALIDATION", message: "Please correct the highlighted fields.", details: e.flatten() } },
      { status: 422 },
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      return NextResponse.json<ApiErr>({ ok: false, error: { code: "CONFLICT", message: "A record with these details already exists." } }, { status: 409 });
    }
    if (e.code === "P2025") {
      return NextResponse.json<ApiErr>({ ok: false, error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
    }
  }
  const msg = String((e as Error)?.message ?? "");
  // Database CHECK constraint / trigger rejections are business-rule violations, not crashes.
  if (/violates check constraint|append-only|immutable|cannot be (deleted|changed|reopened)/i.test(msg)) {
    return NextResponse.json<ApiErr>(
      { ok: false, error: { code: "BUSINESS_RULE", message: "The operation was rejected by a data-integrity rule." } },
      { status: 422 },
    );
  }
  console.error("[api] unhandled error", e instanceof Error ? e.stack : e);
  return NextResponse.json<ApiErr>({ ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
}

export function api<T, B = undefined, Q = undefined>(opts: Options<B, Q>, fn: (ctx: Ctx<B, Q>) => Promise<T>) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }) => {
    const meta = metaFromHeaders(req.headers);
    return requestContext.run(meta, async () => {
      try {
        assertSameOrigin(req);
        const auth = opts.auth ?? "staff";
        let actor: Actor | null = null;
        if (auth !== "public") {
          actor = await getActor();
          if (!actor) throw unauthenticated();
          if (auth === "staff" && actor.kind !== "STAFF") throw forbidden();
          if (auth === "customer" && actor.kind !== "CUSTOMER") throw forbidden();
        }
        let body = undefined as B;
        if (opts.body) {
          const raw = await req.json().catch(() => ({}));
          body = opts.body.parse(raw);
        }
        let query = undefined as Q;
        if (opts.query) query = opts.query.parse(Object.fromEntries(req.nextUrl.searchParams));
        const params = (await routeCtx?.params) ?? {};
        const data = await fn({ req, actor: actor as Actor, body, query, params });
        if (data instanceof Response) return data;
        return NextResponse.json<ApiOk<T>>({ ok: true, data });
      } catch (e) {
        return toErrorResponse(e);
      }
    });
  };
}
