import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logAudit } from "../lib/audit.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

/**
 * GET /auth/session
 *
 * Returns the authenticated user (resolved by the Clerk-backed `requireAuth`
 * middleware, which also enforces org lock/suspension centrally) plus their
 * organisation context. Always reads role + active status from the DB so role
 * changes take effect immediately without re-login.
 */
router.get("/session", requireAuth, async (req, res) => {
  const user = req.user!;

  // Refresh lastLoginAt opportunistically (best-effort, fire-and-forget).
  void db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  res.json({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organisationId: user.organisationId,
    isAuthenticated: true,
  });
});

/**
 * POST /auth/logout
 *
 * The actual sign-out is performed client-side by Clerk (which clears its own
 * session cookie). This endpoint exists so the frontend can record an audit
 * log entry and clear any legacy passkey-era cookies that may still be set in
 * the browser.
 */
router.post("/logout", async (req, res) => {
  await logAudit({ req, action: "auth.logout", outcome: "success" });
  res.clearCookie("eiq.sid", { path: "/" });
  res.clearCookie("connect.sid", { path: "/" });
  res.json({ message: "Logged out successfully" });
});

export default router;
