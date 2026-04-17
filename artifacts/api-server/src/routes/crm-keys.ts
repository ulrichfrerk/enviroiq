import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  CRM_API_SCOPES,
  CRM_API_SCOPE_DESCRIPTIONS,
  generateApiKey,
  parseScopes,
  type CrmApiScope,
} from "../lib/crm-api-keys.js";

const router = Router();

// All key-management endpoints require super-admin (these keys can act across
// every customer organisation, so only the platform operator may issue them).
router.use(requireRole("super_admin"));

// GET /api/crm-keys
router.get("/", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, name, prefix, scopes, last_used_at, last_used_ip,
             revoked_at, expires_at, created_at, created_by_email
      FROM crm_api_keys
      ORDER BY created_at DESC
    `);
    const rows = (result.rows ?? result) as Array<{
      id: string;
      name: string;
      prefix: string;
      scopes: string;
      last_used_at: Date | string | null;
      last_used_ip: string | null;
      revoked_at: Date | string | null;
      expires_at: Date | string | null;
      created_at: Date | string;
      created_by_email: string | null;
    }>;

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        scopes: parseScopes(r.scopes),
        lastUsedAt: r.last_used_at,
        lastUsedIp: r.last_used_ip,
        revokedAt: r.revoked_at,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        createdByEmail: r.created_by_email,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list API keys" });
  }
});

// GET /api/crm-keys/scopes — catalog
router.get("/scopes", (_req, res) => {
  res.json({
    scopes: CRM_API_SCOPES.map((s) => ({ scope: s, description: CRM_API_SCOPE_DESCRIPTIONS[s] })),
  });
});

// POST /api/crm-keys — create key (returns full key ONCE)
router.post("/", async (req, res) => {
  try {
    const { name, scopes, expiresAt } = req.body as {
      name?: string;
      scopes?: string[];
      expiresAt?: string | null;
    };
    if (!name || typeof name !== "string" || name.length < 3) {
      res.status(400).json({ error: "Bad Request", message: "Name (min 3 chars) is required" });
      return;
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "At least one scope is required" });
      return;
    }
    const cleanedScopes = scopes.filter((s): s is CrmApiScope =>
      (CRM_API_SCOPES as readonly string[]).includes(s),
    );
    if (cleanedScopes.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "No valid scopes provided" });
      return;
    }

    const { fullKey, prefix, keyHash } = generateApiKey();
    const id = uuidv4();
    const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

    await db.execute(sql`
      INSERT INTO crm_api_keys
        (id, name, prefix, key_hash, scopes, created_by_id, created_by_email, expires_at)
      VALUES
        (${id}, ${name}, ${prefix}, ${keyHash}, ${cleanedScopes.join(",")},
         ${req.session?.userId ?? null}, ${req.session?.email ?? null}, ${expiresAtDate})
    `);

    await logAudit({
      req,
      action: "crm_api_key.create",
      resourceType: "crm_api_key",
      resourceId: id,
      details: { name, prefix, scopes: cleanedScopes },
    });

    res.status(201).json({
      id,
      name,
      prefix,
      scopes: cleanedScopes,
      expiresAt: expiresAtDate,
      // SHOWN ONCE — never persisted in plaintext.
      fullKey,
      warning:
        "Copy this key now. It will not be shown again. EnviroIQ stores only a one-way hash.",
    });
  } catch (err) {
    req.log.error({ err }, "Create CRM API key failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create API key" });
  }
});

// DELETE /api/crm-keys/:id — revoke
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const result = await db.execute(sql`
      UPDATE crm_api_keys SET revoked_at = NOW() WHERE id = ${id} AND revoked_at IS NULL
      RETURNING id
    `);
    const rows = (result.rows ?? result) as Array<{ id: string }>;
    if (rows.length === 0) {
      res.status(404).json({ error: "Not Found", message: "Key not found or already revoked" });
      return;
    }
    await logAudit({
      req,
      action: "crm_api_key.revoke",
      resourceType: "crm_api_key",
      resourceId: id,
    });
    res.json({ id, revoked: true });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to revoke key" });
  }
});

// GET /api/crm-keys/:id/usage — recent usage (last 100)
router.get("/:id/usage", async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const result = await db.execute(sql`
      SELECT method, path, status_code, ip_address, ts
      FROM crm_api_key_usage
      WHERE key_id = ${id}
      ORDER BY ts DESC
      LIMIT 100
    `);
    const rows = (result.rows ?? result) as Array<{
      method: string;
      path: string;
      status_code: number;
      ip_address: string | null;
      ts: Date | string;
    }>;
    res.json({
      items: rows.map((r) => ({
        method: r.method,
        path: r.path,
        statusCode: r.status_code,
        ipAddress: r.ip_address,
        ts: r.ts,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load usage" });
  }
});

export default router;
