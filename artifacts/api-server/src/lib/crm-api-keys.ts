import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { logger } from "./logger.js";

/**
 * CRM API key scopes.
 * Keep this list narrow and explicit — every new endpoint should reuse one of these.
 */
export const CRM_API_SCOPES = [
  "customers:read",
  "customers:write",
  "users:read",
  "users:write",
  "metrics:read",
  "audits:read",
  "billing:read",
  "billing:write",
] as const;

export type CrmApiScope = (typeof CRM_API_SCOPES)[number];

export const CRM_API_SCOPE_DESCRIPTIONS: Record<CrmApiScope, string> = {
  "customers:read": "List and read customer (organisation) records",
  "customers:write": "Create new customers, update details, lock/unlock accounts",
  "users:read": "List users for any customer",
  "users:write": "Invite users, update roles, deactivate users",
  "metrics:read": "Read ESG metrics, sustainability scores, totals",
  "audits:read": "Read supplier audit status, scores, recurrence info",
  "billing:read": "Read billing plan and account status",
  "billing:write": "Update billing plan, mark account as past due / suspended",
};

/**
 * Ensure the crm_api_keys + crm_api_key_usage tables exist.
 * Called once at boot. Idempotent.
 */
export async function ensureCrmApiKeyTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_api_keys" (
      "id"               text PRIMARY KEY,
      "name"             text NOT NULL,
      "prefix"           text NOT NULL,
      "key_hash"         text NOT NULL UNIQUE,
      "scopes"           text NOT NULL,
      "created_by_id"    text,
      "created_by_email" text,
      "last_used_at"     timestamptz,
      "last_used_ip"     text,
      "revoked_at"       timestamptz,
      "expires_at"       timestamptz,
      "created_at"       timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_crm_api_keys_prefix" ON "crm_api_keys" ("prefix")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_api_key_usage" (
      "id"           text PRIMARY KEY,
      "key_id"       text NOT NULL,
      "method"       text NOT NULL,
      "path"         text NOT NULL,
      "status_code"  integer NOT NULL,
      "ip_address"   text,
      "ts"           timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_crm_api_key_usage_key_ts" ON "crm_api_key_usage" ("key_id", "ts" DESC)
  `);
  logger.info("CRM API key tables ready");
}

/**
 * Generate a fresh API key. The full key is shown to the user EXACTLY ONCE
 * at creation time. Only the sha256 hash is persisted.
 *
 * Format: eiq_live_<28 hex chars>  (32 chars after the prefix)
 * Prefix retained for display: eiq_live_xxxxxxxx (first 8 of secret)
 */
export function generateApiKey(): { fullKey: string; prefix: string; keyHash: string } {
  const secret = randomBytes(20).toString("hex"); // 40 hex chars of entropy (160 bits)
  const fullKey = `eiq_live_${secret}`;
  const prefix = `eiq_live_${secret.slice(0, 8)}`;
  const keyHash = sha256Hex(fullKey);
  return { fullKey, prefix, keyHash };
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Constant-time hex string comparison.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export interface CrmApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: CrmApiScope[];
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  createdByEmail: string | null;
}

export function parseScopes(raw: string | null | undefined): CrmApiScope[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s): s is CrmApiScope =>
    (CRM_API_SCOPES as readonly string[]).includes(s),
  );
}
