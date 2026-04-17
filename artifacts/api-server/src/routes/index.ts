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
import missionRouter from "./mission.js";
import socialRouter from "./social.js";
import governanceRouter from "./governance.js";
import projectsRouter from "./projects.js";
import wasteRouter from "./waste.js";
import subcontractorsRouter from "./subcontractors.js";
import advisorRouter from "./advisor.js";
import emissionFactorsRouter from "./emission-factors.js";
import complianceRouter from "./compliance.js";
import suppliersRouter from "./suppliers.js";
import supplierAuditTemplatesRouter from "./supplier-audit-templates.js";
import supplierAuditsRouter from "./supplier-audits.js";
import supplierReportsRouter from "./supplier-reports.js";
import publicAuditsRouter from "./public-audits.js";
import supplierPortalRouter from "./supplier-portal.js";
import crmRouter from "./crm.js";
import crmKeysRouter from "./crm-keys.js";
import crmOpenapiRouter from "./crm-openapi.js";
import securityRouter from "./security.js";

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
router.use("/organisations/:orgId/mission", missionRouter);
router.use("/organisations/:orgId/social", socialRouter);
router.use("/organisations/:orgId/governance", governanceRouter);
router.use("/organisations/:orgId/projects", projectsRouter);
router.use("/organisations/:orgId/waste", wasteRouter);
router.use("/organisations/:orgId/subcontractors", subcontractorsRouter);
router.use("/organisations/:orgId/advisor", advisorRouter);
router.use("/organisations/:orgId/compliance", complianceRouter);
router.use("/organisations/:orgId/suppliers", suppliersRouter);
router.use("/organisations/:orgId/supplier-audit-templates", supplierAuditTemplatesRouter);
router.use("/organisations/:orgId/supplier-audits", supplierAuditsRouter);
router.use("/organisations/:orgId/supplier-reports", supplierReportsRouter);

// Public supplier audit endpoints (no auth — token-based)
router.use("/public/audits", publicAuditsRouter);
// Supplier portal (cookie-based session)
router.use("/portal", supplierPortalRouter);

// Global emission factors (versioned, available to all authenticated users)
router.use("/emission-factors", emissionFactorsRouter);

// Webhooks (no auth - use API keys/tokens)
router.use("/webhooks/fleet", fleetWebhookRouter);
router.use("/webhooks/energy", energyEmailWebhookRouter);

// Public widget data
router.use("/widget", widgetPublicRouter);

// Admin
router.use("/admin", adminRouter);
router.use("/admin/audit-logs", globalAuditRouter);

// CRM Integration API (Bearer-key authenticated, versioned)
router.use("/crm-keys", crmKeysRouter);
router.use("/v1", crmOpenapiRouter);
router.use("/v1", crmRouter);

// Public grid intensity (no auth, open CORS handled in app.ts)
router.use("/grid", gridRouter);

// Security status (authenticated)
router.use("/security", securityRouter);

export default router;
