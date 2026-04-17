import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { sha256Hex, parseScopes, type CrmApiScope } from "./crm-api-keys.js";

declare module "express-serve-static-core" {
  interface Request {
    crmApiKey?: {
      id: string;
      name: string;
      prefix: string;
      scopes: CrmApiScope[];
    };
  }
}

function getBearerToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
}

/**
 * Express middleware that authenticates a CRM API key via Bearer auth.
 *
 *   Authorization: Bearer eiq_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * On success, attaches req.crmApiKey and updates last-used metadata. On
 * any failure, responds 401 and logs the attempt (without the key value).
 *
 * Pass one or more required scopes — the key MUST possess every scope listed.
 */
export function requireCrmApiKey(...requiredScopes: CrmApiScope[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = getBearerToken(req);
    if (!token || !token.startsWith("eiq_live_")) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Missing or malformed API key. Use header: Authorization: Bearer eiq_live_…",
      });
      return;
    }

    const keyHash = sha256Hex(token);
    const result = await db.execute(sql`
      SELECT id, name, prefix, scopes, revoked_at, expires_at
      FROM crm_api_keys
      WHERE key_hash = ${keyHash}
      LIMIT 1
    `);
    const row = (result.rows ?? result)[0] as
      | {
          id: string;
          name: string;
          prefix: string;
          scopes: string;
          revoked_at: Date | string | null;
          expires_at: Date | string | null;
        }
      | undefined;

    if (!row) {
      req.log.warn({ ip: clientIp(req), path: req.path }, "CRM API key auth failed: unknown key");
      res.status(401).json({ error: "Unauthorized", message: "Invalid API key" });
      return;
    }

    if (row.revoked_at) {
      res.status(401).json({ error: "Unauthorized", message: "API key has been revoked" });
      return;
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      res.status(401).json({ error: "Unauthorized", message: "API key has expired" });
      return;
    }

    const scopes = parseScopes(row.scopes);
    const missing = requiredScopes.filter((s) => !scopes.includes(s));
    if (missing.length > 0) {
      res.status(403).json({
        error: "Forbidden",
        message: `API key is missing required scope(s): ${missing.join(", ")}`,
        requiredScopes,
        keyScopes: scopes,
      });
      return;
    }

    req.crmApiKey = { id: row.id, name: row.name, prefix: row.prefix, scopes };

    // Fire-and-forget: record usage + bump last_used. Never block the request.
    const ip = clientIp(req);
    void db
      .execute(
        sql`UPDATE crm_api_keys SET last_used_at = NOW(), last_used_ip = ${ip} WHERE id = ${row.id}`,
      )
      .catch(() => undefined);

    res.on("finish", () => {
      void db
        .execute(sql`
          INSERT INTO crm_api_key_usage (id, key_id, method, path, status_code, ip_address)
          VALUES (${uuidv4()}, ${row.id}, ${req.method}, ${req.originalUrl.split("?")[0]}, ${res.statusCode}, ${ip})
        `)
        .catch(() => undefined);
    });

    next();
  };
}
