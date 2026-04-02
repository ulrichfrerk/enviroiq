import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import organisationsRouter from "./organisations.js";
import usersRouter from "./users.js";
import fleetRouter, { webhookRouter as fleetWebhookRouter } from "./fleet.js";
import energyRouter, { energyEmailWebhookRouter } from "./energy.js";
import emissionsRouter from "./emissions.js";
import goalsRouter from "./goals.js";
import reportsRouter from "./reports.js";
import widgetRouter, { widgetPublicRouter } from "./widget.js";
import auditRouter, { globalAuditRouter } from "./audit.js";
import adminRouter from "./admin.js";
import gridRouter from "./grid.js";
import targetsRouter from "./targets.js";
import maturityRouter from "./maturity.js";
import scenariosRouter from "./scenarios.js";

const router = Router();

// Health
router.use("/", healthRouter);

// Auth
router.use("/auth", authRouter);

// Organisations + nested routes
router.use("/organisations", organisationsRouter);
router.use("/organisations/:orgId/users", usersRouter);
router.use("/organisations/:orgId/fleet", fleetRouter);
router.use("/organisations/:orgId/energy", energyRouter);
router.use("/organisations/:orgId/emissions", emissionsRouter);
router.use("/organisations/:orgId/goals", goalsRouter);
router.use("/organisations/:orgId/reports", reportsRouter);
router.use("/organisations/:orgId/widget", widgetRouter);
router.use("/organisations/:orgId/audit-logs", auditRouter);
router.use("/organisations/:orgId/targets", targetsRouter);
router.use("/organisations/:orgId/maturity", maturityRouter);
router.use("/organisations/:orgId/scenarios", scenariosRouter);

// Webhooks (no auth - use API keys/tokens)
router.use("/webhooks/fleet", fleetWebhookRouter);
router.use("/webhooks/energy", energyEmailWebhookRouter);

// Public widget data
router.use("/widget", widgetPublicRouter);

// Admin
router.use("/admin", adminRouter);
router.use("/admin/audit-logs", globalAuditRouter);

// Public grid intensity (no auth, open CORS handled in app.ts)
router.use("/grid", gridRouter);

export default router;
