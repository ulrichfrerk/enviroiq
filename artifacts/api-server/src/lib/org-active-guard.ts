import { db } from "@workspace/db";
import { organisationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export interface OrgActiveResult {
  ok: boolean;
  reason?: "missing" | "locked" | "suspended" | "past_due";
  message?: string;
}

/**
 * Verify a user's organisation is in good standing for login.
 * - super_admin role has no organisationId — always allowed.
 * - Missing org row → reject (data inconsistency).
 * - is_active=false → "locked" (manually locked or billing suspended).
 * - billing_status='suspended' → "suspended" (separate enforcement guarantee).
 *
 * past_due is allowed to log in (with a soft warning surfaced elsewhere) so
 * the customer can update payment details. Only `suspended` and explicit
 * `is_active=false` block authentication.
 */
export async function checkOrgLoginAllowed(
  organisationId: string | null | undefined,
): Promise<OrgActiveResult> {
  if (!organisationId) return { ok: true }; // super_admin etc.
  const org = await db.query.organisationsTable.findFirst({
    where: eq(organisationsTable.id, organisationId),
  });
  if (!org) return { ok: false, reason: "missing", message: "Organisation not found" };
  if (org.billingStatus === "suspended") {
    return {
      ok: false,
      reason: "suspended",
      message: "This account has been suspended. Please contact your administrator.",
    };
  }
  if (!org.isActive) {
    return {
      ok: false,
      reason: "locked",
      message: "This account has been locked. Please contact your administrator.",
    };
  }
  return { ok: true };
}
