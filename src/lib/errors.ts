export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BUSINESS_RULE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BUSINESS_RULE: 422,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Please sign in.");
export const forbidden = (msg = "You do not have permission to perform this action.") => new AppError("FORBIDDEN", msg);
/** Used for records outside the actor's scope too, so existence is not leaked. */
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const rule = (msg: string, details?: unknown) => new AppError("BUSINESS_RULE", msg, details);
export const invalid = (msg: string, details?: unknown) => new AppError("VALIDATION", msg, details);
