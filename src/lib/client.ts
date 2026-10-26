"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super(message);
  }
}

/** JSON fetch against our API. Throws ApiError with server message and field errors. */
export async function apiFetch<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Session expired", "UNAUTHENTICATED");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    const err = json?.error ?? { message: "Something went wrong.", code: "INTERNAL" };
    throw new ApiError(err.message, err.code, err.details?.fieldErrors ?? {});
  }
  return json.data as T;
}
