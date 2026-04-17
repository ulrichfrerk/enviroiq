/**
 * Per-request correlation ID middleware. The CRM (or any caller) may pass
 * `X-Correlation-ID` to tie multi-step workflows together; otherwise we mint
 * a UUID. The ID is echoed back in `X-Correlation-ID` and surfaces in:
 *   - response.meta.requestId  (FGC envelope)
 *   - audit_logs.correlation_id (for cross-system tracing)
 */
import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

declare module "express-serve-static-core" {
  interface Request {
    correlationId?: string;
    idempotencyKey?: string;
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-correlation-id"];
  const id =
    typeof incoming === "string" && incoming.length > 0 && incoming.length < 128
      ? incoming
      : uuidv4();
  req.correlationId = id;
  res.setHeader("X-Correlation-ID", id);
  next();
}
