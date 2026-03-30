import { Router } from "express";
import { db, widgetConfigsTable, organisationsTable, goalsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { calcSustainabilityScore } from "../lib/emissions.js";
import { sqlRow, numCol, intCol } from "../lib/sql-result.js";

const router = Router({ mergeParams: true });
export const widgetPublicRouter = Router();

// GET /organisations/:orgId/widget/config
router.get("/config", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }

    let config = await db.query.widgetConfigsTable.findFirst({
      where: eq(widgetConfigsTable.organisationId, orgId),
    });

    if (!config) {
      const [newConfig] = await db.insert(widgetConfigsTable).values({ organisationId: orgId }).returning();
      config = newConfig;
    }

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost";
    const embedScript = `<script src="https://${domain}/api/widget/${org.widgetKey}/widget.js" async></script>\n<div id="enviroiq-widget"></div>`;

    res.json({ ...config, widgetKey: org.widgetKey, embedScript });
  } catch (err) {
    req.log.error({ err }, "Get widget config failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get widget config" });
  }
});

// PUT /organisations/:orgId/widget/config
router.put("/config", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const {
      isEnabled, title, showTotalCo2e, showFleetStats, showEnergyUsage,
      showGoals, showSustainabilityScore, showLastUpdated,
      accentColor, theme, period,
    } = req.body;

    const [config] = await db
      .insert(widgetConfigsTable)
      .values({
        organisationId: orgId,
        isEnabled: isEnabled ?? true,
        title,
        showTotalCo2e: showTotalCo2e ?? true,
        showFleetStats: showFleetStats ?? true,
        showEnergyUsage: showEnergyUsage ?? true,
        showGoals: showGoals ?? true,
        showSustainabilityScore: showSustainabilityScore ?? true,
        showLastUpdated: showLastUpdated ?? true,
        accentColor: accentColor ?? "#22c55e",
        theme: theme ?? "light",
        period: period ?? "month",
      })
      .onConflictDoUpdate({
        target: widgetConfigsTable.organisationId,
        set: {
          isEnabled, title, showTotalCo2e, showFleetStats, showEnergyUsage,
          showGoals, showSustainabilityScore, showLastUpdated,
          accentColor, theme, period,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json(config);
  } catch (err) {
    req.log.error({ err }, "Update widget config failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update widget config" });
  }
});

// GET /widget/:widgetKey/widget.js — public embeddable JS snippet
widgetPublicRouter.get("/:widgetKey/widget.js", async (req, res) => {
  try {
    const widgetKey = req.params.widgetKey as string;
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.widgetKey, widgetKey),
    });

    if (!org || !org.isActive) {
      res.status(404).type("application/javascript").send("/* EnviroIQ widget: not found */");
      return;
    }

    const config = await db.query.widgetConfigsTable.findFirst({
      where: eq(widgetConfigsTable.organisationId, org.id),
    });

    if (!config?.isEnabled) {
      res.status(404).type("application/javascript").send("/* EnviroIQ widget: disabled */");
      return;
    }

    const domain = req.get("host") || (process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost");
    const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
    const apiBase = `${protocol}://${domain}/api/widget/${widgetKey}`;
    const accentColor = config.accentColor || "#22c55e";
    const title = config.title || org.name;
    const theme = config.theme || "light";

    const showTotalCo2e = config.showTotalCo2e !== false;
    const showSustainabilityScore = config.showSustainabilityScore !== false;
    const showFleetStats = config.showFleetStats !== false;
    const showEnergyUsage = config.showEnergyUsage !== false;
    const showGoals = config.showGoals !== false;
    const showLastUpdated = config.showLastUpdated !== false;

    const js = `(function(){
  'use strict';
  var apiBase = ${JSON.stringify(apiBase)};
  var accent = ${JSON.stringify(accentColor)};
  var widgetTitle = ${JSON.stringify(title)};
  var theme = ${JSON.stringify(theme)};
  var cfg = {
    showTotalCo2e: ${showTotalCo2e},
    showSustainabilityScore: ${showSustainabilityScore},
    showFleetStats: ${showFleetStats},
    showEnergyUsage: ${showEnergyUsage},
    showGoals: ${showGoals},
    showLastUpdated: ${showLastUpdated}
  };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){ if(k==='style'){Object.assign(e.style,attrs[k]);}else{e.setAttribute(k,attrs[k]);} });
    if (children) children.forEach(function(c){ if(c) e.appendChild(typeof c==='string'?document.createTextNode(c):c); });
    return e;
  }

  function fmt(n) { return typeof n==='number' ? n.toLocaleString(undefined,{maximumFractionDigits:1}) : '\u2014'; }

  function render(data, container) {
    var bg = theme==='dark'?'#1a1a1a':'#ffffff';
    var fg = theme==='dark'?'#f1f5f9':'#0f172a';
    var muted = theme==='dark'?'#94a3b8':'#64748b';
    var border = theme==='dark'?'#334155':'#e2e8f0';
    var card = theme==='dark'?'#0f172a':'#f8fafc';

    var metrics = [];
    if (cfg.showTotalCo2e) metrics.push(el('div',{style:{background:card,borderRadius:'8px',padding:'12px'}},[
      el('div',{style:{fontSize:'11px',color:muted,marginBottom:'4px'}},['Total CO\u2082e']),
      el('div',{style:{fontSize:'22px',fontWeight:'700',color:accent}},[fmt(data.totalCo2eKg/1000)+' t']),
    ]));
    if (cfg.showSustainabilityScore) metrics.push(el('div',{style:{background:card,borderRadius:'8px',padding:'12px'}},[
      el('div',{style:{fontSize:'11px',color:muted,marginBottom:'4px'}},['Sustainability']),
      el('div',{style:{fontSize:'22px',fontWeight:'700',color:accent}},[fmt(data.sustainabilityScore)+'/100']),
    ]));
    if (cfg.showFleetStats) metrics.push(el('div',{style:{background:card,borderRadius:'8px',padding:'12px'}},[
      el('div',{style:{fontSize:'11px',color:muted,marginBottom:'4px'}},['Fleet Distance']),
      el('div',{style:{fontSize:'18px',fontWeight:'600',color:fg}},[fmt(data.fleetDistanceKm)+' km']),
    ]));
    if (cfg.showEnergyUsage) metrics.push(el('div',{style:{background:card,borderRadius:'8px',padding:'12px'}},[
      el('div',{style:{fontSize:'11px',color:muted,marginBottom:'4px'}},['Energy (kWh)']),
      el('div',{style:{fontSize:'18px',fontWeight:'600',color:fg}},[fmt(data.totalEnergyKwh)]),
    ]));

    var goalEls = null;
    if (cfg.showGoals && data.goals && data.goals.length) {
      goalEls = el('div',{style:{marginTop:'14px'}},[
        el('div',{style:{fontSize:'12px',color:muted,marginBottom:'8px',fontWeight:'600'}},['Sustainability Goals']),
        ...data.goals.slice(0,3).map(function(g){
          return el('div',{style:{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'}},[
            el('div',{style:{width:'8px',height:'8px',borderRadius:'50%',background:g.status==='on_track'?accent:'#f59e0b',flexShrink:'0'}}),
            el('span',{style:{fontSize:'12px',color:fg}},[g.title])
          ]);
        })
      ]);
    }

    container.innerHTML = '';
    container.appendChild(el('div',{style:{fontFamily:'system-ui,sans-serif',background:bg,color:fg,borderRadius:'12px',border:'1px solid '+border,padding:'20px',maxWidth:'420px',boxSizing:'border-box'}},[
      el('div',{style:{display:'flex',alignItems:'center',marginBottom:'16px',gap:'8px'}},[
        el('div',{style:{width:'10px',height:'10px',borderRadius:'50%',background:accent}}),
        el('span',{style:{fontWeight:'700',fontSize:'15px',color:fg}},[widgetTitle]),
        el('span',{style:{marginLeft:'auto',fontSize:'11px',color:muted}},['Powered by EnviroIQ'])
      ]),
      metrics.length ? el('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}},metrics) : null,
      goalEls,
      cfg.showLastUpdated ? el('div',{style:{marginTop:'14px',fontSize:'10px',color:muted,textAlign:'right'}},[
        'Updated: '+new Date(data.lastUpdated).toLocaleDateString()
      ]) : null
    ]));
  }

  function init() {
    var targets = document.querySelectorAll('#enviroiq-widget,[data-enviroiq-key="${widgetKey}"]');
    if (!targets.length) return;
    targets.forEach(function(container) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-family:system-ui">Loading ESG data\u2026</div>';
      fetch(apiBase+'/data')
        .then(function(r){ return r.json(); })
        .then(function(data){ render(data, container); })
        .catch(function(){ container.innerHTML = '<div style="padding:20px;text-align:center;color:#f87171;font-family:system-ui">Unable to load ESG data</div>'; });
    });
  }

  if (document.readyState==='loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();`;

    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(js);
  } catch (err) {
    res.status(500).type("application/javascript").send("/* EnviroIQ widget: server error */");
  }
});

// GET /widget/:widgetKey/data — public, no auth
widgetPublicRouter.get("/:widgetKey/data", async (req, res) => {
  try {
    const widgetKey = req.params.widgetKey as string;
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.widgetKey, widgetKey),
    });

    if (!org || !org.isActive) {
      res.status(404).json({ error: "Not Found", message: "Widget not found" });
      return;
    }

    const config = await db.query.widgetConfigsTable.findFirst({
      where: eq(widgetConfigsTable.organisationId, org.id),
    });

    if (!config?.isEnabled) {
      res.status(404).json({ error: "Not Found", message: "Widget is disabled" });
      return;
    }

    const now = new Date();
    let fromDate = new Date();
    const period = config.period || "month";
    switch (period) {
      case "month": fromDate.setMonth(now.getMonth() - 1); break;
      case "quarter": fromDate.setMonth(now.getMonth() - 3); break;
      case "year": fromDate.setFullYear(now.getFullYear() - 1); break;
    }

    const [fleetResult, energyResult, goals] = await Promise.all([
      db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0) as co2e, COALESCE(SUM(distance_km),0) as dist, COUNT(DISTINCT vehicle_id) as vehicles FROM fleet_events WHERE organisation_id = ${org.id} AND recorded_at >= ${fromDate}`),
      db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0) as co2e, COALESCE(SUM(usage_kwh),0) as kwh FROM energy_readings WHERE organisation_id = ${org.id} AND period_start >= ${fromDate}`),
      db.query.goalsTable.findMany({ where: eq(goalsTable.organisationId, org.id) }),
    ]);

    const fr = sqlRow(fleetResult);
    const er = sqlRow(energyResult);

    const fleetCo2e = numCol(fr, "co2e");
    const energyCo2e = numCol(er, "co2e");
    const fleetDist = numCol(fr, "dist");
    const goalsOnTrack = goals.filter((g) => g.status === "on_track").length;

    const score = calcSustainabilityScore({
      totalCo2eKg: fleetCo2e + energyCo2e,
      fleetDistanceKm: fleetDist,
      goalsOnTrack,
      totalGoals: goals.length,
    });

    res.json({
      organisationName: org.name,
      period,
      config,
      totalCo2eKg: fleetCo2e + energyCo2e,
      fleetCo2eKg: fleetCo2e,
      energyCo2eKg: energyCo2e,
      totalEnergyKwh: numCol(er, "kwh"),
      fleetDistanceKm: fleetDist,
      sustainabilityScore: score,
      activeVehicles: intCol(fr, "vehicles"),
      goals: goals
        .filter((g) => g.isPublic)
        .map((g) => ({ title: g.title, progressPercent: 0, status: g.status })),
      lastUpdated: now.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get widget data" });
  }
});

export default router;
