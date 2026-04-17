/**
 * FGC Customer Operations API Standard v1 — response envelope.
 *
 * Every response is wrapped in `{ success, data | error, meta, [pagination] }`.
 * Never return bare arrays or bare objects from versioned (/api/v1) endpoints.
 *
 * Usage:
 *   res.json(ok(payload, req));
 *   res.status(201).json(created(newRecord, req));
 *   res.json(paginated(items, { page, limit, total }, req));
 *   throw Errors.notFound("Customer", id);
 */
import type { Request, Response } from "express";

export const FGC_API_VERSION = "v1";

export interface ApiMeta {
  timestamp: string;
  version: string;
  requestId: string;
}

export interface ApiPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

function meta(req: Request): ApiMeta {
  return {
    timestamp: new Date().toISOString(),
    version: FGC_API_VERSION,
    requestId: req.correlationId ?? (req as unknown as { id?: string }).id ?? "",
  };
}

export function ok<T>(data: T, req: Request) {
  return { success: true as const, data, meta: meta(req) };
}

export function created<T>(data: T, req: Request) {
  return { success: true as const, data, meta: meta(req) };
}

export function paginated<T>(
  items: T[],
  page: { page: number; limit: number; total: number },
  req: Request,
) {
  const totalPages = Math.max(1, Math.ceil(page.total / Math.max(1, page.limit)));
  return {
    success: true as const,
    data: items,
    pagination: {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages,
      hasMore: page.page < totalPages,
    } as ApiPagination,
    meta: meta(req),
  };
}

export function noContent(res: Response) {
  res.status(204).end();
}

/* --------------------------------------------------------------- */
/* Errors                                                          */
/* --------------------------------------------------------------- */

export type FgcErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UPSTREAM_ERROR";

const STATUS_FOR: Record<FgcErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
};

export class ApiError extends Error {
  public readonly code: FgcErrorCode;
  public readonly status: number;
  public readonly details?: unknown;
  constructor(code: FgcErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR[code];
    this.details = details;
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) =>
    new ApiError("BAD_REQUEST", message, details),
  unauthorized: (message = "Missing or invalid API key") =>
    new ApiError("UNAUTHORIZED", message),
  forbidden: (message = "Insufficient scope or permissions", details?: unknown) =>
    new ApiError("FORBIDDEN", message, details),
  notFound: (resource: string, id?: string) =>
    new ApiError(
      "NOT_FOUND",
      id ? `${resource} not found: ${id}` : `${resource} not found`,
    ),
  conflict: (message: string, details?: unknown) =>
    new ApiError("CONFLICT", message, details),
  unprocessable: (message: string, details?: unknown) =>
    new ApiError("UNPROCESSABLE", message, details),
  rateLimited: (message = "Rate limit exceeded") =>
    new ApiError("RATE_LIMITED", message),
  internal: (message = "Internal server error") =>
    new ApiError("INTERNAL_ERROR", message),
  upstream: (message = "Upstream service unavailable") =>
    new ApiError("UPSTREAM_ERROR", message),
};

/**
 * Express error handler — converts ApiError into the FGC error envelope.
 * Mount at the very end of the /api/v1 router stack.
 */
function isZodError(err: unknown): err is { issues: unknown[]; name?: string } {
  return (
    !!err &&
    typeof err === "object" &&
    Array.isArray((err as { issues?: unknown }).issues) &&
    ((err as { name?: string }).name === "ZodError" ||
      (err as { constructor?: { name?: string } }).constructor?.name === "ZodError")
  );
}

export function fgcErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: import("express").NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      meta: meta(req),
    });
    return;
  }
  // Surface zod validation failures as standard FGC envelopes instead of 500s.
  if (isZodError(err)) {
    res.status(400).json({
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request payload",
        details: (err as { issues: unknown[] }).issues,
      },
      meta: meta(req),
    });
    return;
  }
  // Express body-parser produces these for malformed JSON.
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      error: { code: "BAD_REQUEST", message: "Malformed JSON body" },
      meta: meta(req),
    });
    return;
  }
  req.log?.error?.({ err }, "Unhandled API error");
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
    meta: meta(req),
  });
}

/**
 * Wraps an async route handler so thrown ApiErrors and rejected promises are
 * forwarded to fgcErrorHandler. Drops the need for try/catch in every route.
 */
export function asyncRoute<T>(
  fn: (req: Request, res: Response) => Promise<T>,
) {
  return (req: Request, res: Response, next: import("express").NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
