/**
 * Idempotency-Key middleware (FGC standard).
 *
 * The CRM passes `Idempotency-Key: <uuid>` on POST/PATCH/DELETE. We persist
 * the (scope, key, body-hash, response) tuple in the `idempotency_keys` table
 * for 24h. On replay:
 *   - same key + same body → return cached status + body
 *   - same key + different body → 409 CONFLICT
 *   - new key → execute the handler, persist result on completion
 *
 * Scope is derived from the authenticated CRM API key id, so two different
 * integrations cannot collide on a shared key value.
 */
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { Errors } from "./api-response.js";

const TTL_MS = 24 * 60 * 60 * 1000;

function bodyHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(body ?? {}))
    .digest("hex");
}

/**
 * Mount per route. Only acts on POST/PATCH/DELETE that include
 * `Idempotency-Key`. Without the header, the handler runs as normal.
 */
export function idempotency() {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = req.headers["idempotency-key"];
    if (!key || typeof key !== "string") return next();
    if (!["POST", "PATCH", "DELETE"].includes(req.method)) return next();

    // Scope keys to the API caller AND the specific endpoint so the same key
    // value cannot collide across different endpoints.
    const scope = `crm:${req.crmApiKey?.id ?? "anon"}:${req.method}:${req.baseUrl}${req.path}`;
    const hash = bodyHash(req.body);
    const expiresAt = new Date(Date.now() + TTL_MS);

    // Race-safe: insert an in-flight placeholder row FIRST. If the unique
    // constraint fires we know another request is already in flight or has
    // completed — in which case we look up the existing row and either replay
    // its cached response or, if it's still in flight (response_status = 0),
    // return 409 CONFLICT to tell the caller to retry shortly.
    let weOwnExecution = false;
    try {
      const inserted = await db.execute(sql`
        INSERT INTO idempotency_keys
          (id, scope, key, method, path, body_hash, response_status, response_body, expires_at)
        VALUES
          (${uuidv4()}, ${scope}, ${key}, ${req.method}, ${req.path},
           ${hash}, 0, '', ${expiresAt})
        ON CONFLICT (scope, key) DO NOTHING
        RETURNING id
      `);
      const insertedRows = (inserted as { rows?: Array<{ id: string }> }).rows ?? [];
      weOwnExecution = insertedRows.length > 0;

      if (!weOwnExecution) {
        const existing = await db.execute(sql`
          SELECT response_status, response_body, body_hash
          FROM idempotency_keys
          WHERE scope = ${scope} AND key = ${key} AND expires_at > NOW()
          LIMIT 1
        `);
        const row = ((existing as { rows?: Array<{ response_status: number; response_body: string; body_hash: string }> }).rows ?? [])[0];
        if (!row) return next(); // expired between insert + lookup; proceed

        if (row.body_hash !== hash) {
          return next(
            Errors.conflict(
              "Idempotency-Key has been used with a different request body. Use a fresh key.",
              { key },
            ),
          );
        }
        if (row.response_status === 0) {
          // First request still in flight — tell caller to retry.
          return next(
            Errors.conflict(
              "Idempotency-Key request is still in flight. Retry shortly.",
              { key, in_flight: true },
            ),
          );
        }
        req.idempotencyKey = key;
        res.setHeader("Idempotent-Replay", "true");
        res.status(row.response_status).type("application/json").send(row.response_body);
        return;
      }
    } catch (err) {
      req.log?.warn?.({ err, key }, "Idempotency lookup failed; proceeding without replay safety");
      return next();
    }

    req.idempotencyKey = key;
    // Capture the outgoing payload so we can update the placeholder row.
    const originalJson = res.json.bind(res);
    let captured: unknown;
    res.json = function (body: unknown) {
      captured = body;
      return originalJson(body);
    };
    res.on("finish", () => {
      if (res.statusCode >= 500 || captured === undefined) {
        // Failed — drop the placeholder so the caller can retry cleanly.
        void db
          .execute(sql`DELETE FROM idempotency_keys WHERE scope = ${scope} AND key = ${key} AND response_status = 0`)
          .catch(() => undefined);
        return;
      }
      void db
        .execute(sql`
          UPDATE idempotency_keys
          SET response_status = ${res.statusCode},
              response_body = ${JSON.stringify(captured)}
          WHERE scope = ${scope} AND key = ${key}
        `)
        .catch(() => undefined);
    });

    next();
  };
}
