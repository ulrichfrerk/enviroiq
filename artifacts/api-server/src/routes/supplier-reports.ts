// Supplier ESG reporting — dashboard summary + branded PDF.
import { Router } from "express";
import { db, suppliersTable, supplierAuditsTable, organisationsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { htmlToPdf } from "../lib/pdf.js";

const router = Router({ mergeParams: true });

interface SupplierRow {
  id: string;
  legalName: string;
  riskTag: string;
  status: string;
  isCritical: boolean;
  latestEsgScore: number | null;
  latestRiskLevel: string | null;
  lastAuditAt: Date | null;
  nextAuditDueAt: Date | null;
}

async function buildSummary(orgId: string) {
  const suppliers = (await db.select().from(suppliersTable)
    .where(eq(suppliersTable.organisationId, orgId))) as unknown as SupplierRow[];

  const audits = await db.select().from(supplierAuditsTable)
    .where(eq(supplierAuditsTable.organisationId, orgId));

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400_000);

  const total = suppliers.length;
  const active = suppliers.filter((s) => s.status === "active").length;
  const critical = suppliers.filter((s) => s.isCritical).length;

  const scoredSuppliers = suppliers.filter((s) => s.latestEsgScore !== null && s.latestEsgScore !== undefined);
  const avgScore = scoredSuppliers.length === 0 ? 0 :
    Math.round(scoredSuppliers.reduce((sum, s) => sum + (s.latestEsgScore ?? 0), 0) / scoredSuppliers.length);

  const riskCounts = {
    low: scoredSuppliers.filter((s) => s.latestRiskLevel === "low").length,
    medium: scoredSuppliers.filter((s) => s.latestRiskLevel === "medium").length,
    high: scoredSuppliers.filter((s) => s.latestRiskLevel === "high").length,
    unrated: total - scoredSuppliers.length,
  };

  const auditsByStatus = {
    draft: audits.filter((a) => a.status === "draft").length,
    sent: audits.filter((a) => a.status === "sent").length,
    in_progress: audits.filter((a) => a.status === "in_progress").length,
    submitted: audits.filter((a) => a.status === "submitted").length,
    approved: audits.filter((a) => a.status === "approved").length,
    expired: audits.filter((a) => a.status === "expired").length,
  };

  const overdue = audits.filter((a) => a.dueAt < now && !["submitted", "approved", "revoked"].includes(a.status)).length;
  const dueSoon = suppliers.filter((s) => s.nextAuditDueAt && s.nextAuditDueAt > now && s.nextAuditDueAt <= in30).length;
  const compliantPct = total === 0 ? 0 : Math.round((scoredSuppliers.filter((s) => (s.latestEsgScore ?? 0) >= 80).length / total) * 100);

  // Top suppliers by score (desc) + bottom (worst risk)
  const ranked = [...scoredSuppliers].sort((a, b) => (b.latestEsgScore ?? 0) - (a.latestEsgScore ?? 0));
  const top = ranked.slice(0, 5).map((s) => ({ id: s.id, legalName: s.legalName, score: s.latestEsgScore, risk: s.latestRiskLevel }));
  const bottom = ranked.slice(-5).reverse().map((s) => ({ id: s.id, legalName: s.legalName, score: s.latestEsgScore, risk: s.latestRiskLevel }));

  return {
    total, active, critical, avgScore, compliantPct, overdue, dueSoon,
    riskCounts, auditsByStatus, top, bottom,
    suppliers: suppliers.map((s) => ({
      id: s.id, legalName: s.legalName, riskTag: s.riskTag, isCritical: s.isCritical,
      status: s.status, latestEsgScore: s.latestEsgScore, latestRiskLevel: s.latestRiskLevel,
      lastAuditAt: s.lastAuditAt, nextAuditDueAt: s.nextAuditDueAt,
    })),
  };
}

router.get("/summary", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const summary = await buildSummary(orgId);
    res.json(summary);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function renderPdfHtml(orgName: string, generatedAt: Date, s: Awaited<ReturnType<typeof buildSummary>>): string {
  const dateStr = generatedAt.toLocaleDateString("en-NZ", { dateStyle: "long" });
  const supplierRows = s.suppliers.map((row) => `
    <tr>
      <td>${escapeHtml(row.legalName)}${row.isCritical ? " <span style='color:#b91c1c;font-weight:600'>· Critical</span>" : ""}</td>
      <td style="text-transform:capitalize">${row.riskTag}</td>
      <td>${row.latestEsgScore !== null && row.latestEsgScore !== undefined ? `${row.latestEsgScore}` : "—"}</td>
      <td style="text-transform:capitalize">${row.latestRiskLevel ?? "—"}</td>
      <td>${row.lastAuditAt ? new Date(row.lastAuditAt).toLocaleDateString("en-NZ") : "Never"}</td>
      <td>${row.nextAuditDueAt ? new Date(row.nextAuditDueAt).toLocaleDateString("en-NZ") : "—"}</td>
    </tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Supplier ESG Report</title>
<style>
*{box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;margin:0;color:#0B0D0F;background:#fff}
.cover{background:linear-gradient(135deg,#0B0D0F 0%,#22C55E 100%);color:#fff;padding:80px 60px;height:297mm;page-break-after:always;display:flex;flex-direction:column;justify-content:space-between}
.cover h1{font-size:48px;margin:0 0 12px;font-weight:800;letter-spacing:-1px}
.cover .sub{font-size:18px;opacity:0.85}
.cover .meta{font-size:14px;opacity:0.7}
.brand{font-size:24px;font-weight:700;letter-spacing:-0.5px}
.brand .iq{color:#22C55E}
.cover .brand .iq{color:#fff;text-decoration:underline}
.section{padding:36px 48px;page-break-inside:avoid}
h2{font-size:22px;color:#0B0D0F;margin:0 0 16px;border-bottom:2px solid #22C55E;padding-bottom:8px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 28px}
.kpi{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px}
.kpi .v{font-size:28px;font-weight:800;color:#0B0D0F}
.kpi .l{font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px}
.risk-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 24px}
.risk-cell{padding:14px;border-radius:8px;text-align:center}
.risk-cell .n{font-size:28px;font-weight:800}
.risk-cell .l{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;opacity:0.85}
.risk-low{background:#DCFCE7;color:#166534}
.risk-medium{background:#FEF3C7;color:#92400E}
.risk-high{background:#FEE2E2;color:#991B1B}
.risk-unrated{background:#F1F5F9;color:#475569}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}
th{text-align:left;padding:8px 10px;background:#F1F5F9;color:#0B0D0F;border-bottom:2px solid #E2E8F0;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.04em}
td{padding:8px 10px;border-bottom:1px solid #F1F5F9}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.callout{background:#0B0D0F;color:#fff;padding:18px;border-radius:8px;font-size:12px;line-height:1.5}
.callout .iq{color:#22C55E;font-weight:600}
</style></head>
<body>
<div class="cover">
  <div><div class="brand">Enviro<span class="iq">IQ</span></div></div>
  <div>
    <h1>Supplier ESG<br/>Assurance Report</h1>
    <div class="sub">${escapeHtml(orgName)}</div>
    <div class="meta" style="margin-top:24px">Generated ${dateStr}</div>
  </div>
  <div class="meta">Confidential — for ${escapeHtml(orgName)} board &amp; assurance use</div>
</div>

<div class="section">
  <h2>Programme overview</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="v">${s.total}</div><div class="l">Suppliers</div></div>
    <div class="kpi"><div class="v">${s.critical}</div><div class="l">Critical</div></div>
    <div class="kpi"><div class="v">${s.avgScore}</div><div class="l">Avg ESG score</div></div>
    <div class="kpi"><div class="v">${s.compliantPct}%</div><div class="l">≥ 80 score</div></div>
  </div>

  <h2 style="margin-top:24px">Risk heat-map</h2>
  <div class="risk-grid">
    <div class="risk-cell risk-low"><div class="n">${s.riskCounts.low}</div><div class="l">Low risk</div></div>
    <div class="risk-cell risk-medium"><div class="n">${s.riskCounts.medium}</div><div class="l">Medium risk</div></div>
    <div class="risk-cell risk-high"><div class="n">${s.riskCounts.high}</div><div class="l">High risk</div></div>
    <div class="risk-cell risk-unrated"><div class="n">${s.riskCounts.unrated}</div><div class="l">Unrated</div></div>
  </div>

  <div class="two-col" style="margin-top:24px">
    <div>
      <h2>Audits in flight</h2>
      <table>
        <tr><th>Status</th><th style="text-align:right">Count</th></tr>
        <tr><td>Sent / open</td><td style="text-align:right">${s.auditsByStatus.sent + s.auditsByStatus.in_progress}</td></tr>
        <tr><td>Submitted (awaiting review)</td><td style="text-align:right">${s.auditsByStatus.submitted}</td></tr>
        <tr><td>Approved</td><td style="text-align:right">${s.auditsByStatus.approved}</td></tr>
        <tr><td>Expired</td><td style="text-align:right">${s.auditsByStatus.expired}</td></tr>
        <tr><td>Overdue</td><td style="text-align:right;color:#b91c1c;font-weight:600">${s.overdue}</td></tr>
        <tr><td>Due in next 30 days</td><td style="text-align:right">${s.dueSoon}</td></tr>
      </table>
    </div>
    <div>
      <h2>Top performing suppliers</h2>
      <table>
        <tr><th>Supplier</th><th style="text-align:right">Score</th></tr>
        ${s.top.length ? s.top.map((t) => `<tr><td>${escapeHtml(t.legalName)}</td><td style="text-align:right;font-weight:600">${t.score}</td></tr>`).join("")
          : '<tr><td colspan="2" style="color:#94A3B8">No scored suppliers yet.</td></tr>'}
      </table>
    </div>
  </div>
</div>

<div class="section" style="page-break-before:always">
  <h2>Full supplier register</h2>
  <table>
    <thead><tr>
      <th>Supplier</th><th>Risk tag</th><th>Score</th><th>Risk</th><th>Last audit</th><th>Next due</th>
    </tr></thead>
    <tbody>${supplierRows || '<tr><td colspan="6" style="color:#94A3B8;text-align:center;padding:24px">No suppliers registered yet.</td></tr>'}</tbody>
  </table>

  <div class="callout" style="margin-top:24px">
    <span class="iq">EnviroIQ</span> — supplier scores are computed from the most recent submitted audit using the GHG Protocol /
    GRI / TCFD-aligned questionnaire. Each audit is timestamped, version-locked and auditable from the Compliance Evidence Pack.
  </div>
</div>
</body></html>`;
}

router.get("/pdf", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) { res.status(404).json({ error: "Organisation not found" }); return; }
    const summary = await buildSummary(orgId);

    if (req.query.format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderPdfHtml(org.name, new Date(), summary));
      return;
    }

    const pdf = await htmlToPdf(renderPdfHtml(org.name, new Date(), summary), {
      footerLabel: `EnviroIQ · Supplier ESG Report · ${org.name}`,
    });
    const fname = `supplier-esg-report-${org.slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } catch (err) {
    req.log.error({ err }, "Supplier report PDF render failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
