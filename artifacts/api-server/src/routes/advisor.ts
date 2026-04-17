import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { z } from "zod";
import { randomUUID } from "crypto";

const router = Router({ mergeParams: true });

// ── NZ Policy context injected into every AI advisor call ─────────────────────
const NZ_POLICY_CONTEXT = `
You are an expert NZ ESG advisor embedded in the EnviroIQ platform. You have deep knowledge of:

## NZ CLIMATE POLICY FRAMEWORK (as at April 2026)

### Emissions Targets
- 2050 target: Net zero all GHGs except biogenic methane; biogenic methane −14–24%
- Emissions Budget 1 (2022–2025): 290 Mt CO₂e — now ending
- Emissions Budget 2 (2026–2030): 305 Mt CO₂e — NOW ACTIVE (ERP2 in force)
- Emissions Budget 3 (2031–2035): ~240 Mt CO₂e
- NZ's 2030 NDC: −50% below 2005 gross emissions

### Second Emissions Reduction Plan (ERP2 — December 2024, active from end of 2025)
Sector actions businesses should know:
- TRANSPORT: EV uptake incentives, clean car discount, biofuel blend mandates, road pricing expansion, 
  government fleet carbon neutral target, heavy vehicle electrification support
- ENERGY: Industrial coal phase-out by 2030, electrification of process heat, 
  renewable electricity contracts (market-based Scope 2 reduction)
- BUILDINGS: Phase-out of new gas connections, heat pump adoption, building efficiency standards
- AGRICULTURE: Research into methane inhibitors, He Waka Eke Noa primary sector partnership
- FORESTRY: Afforestation support, carbon sequestration via ETS

### NZ Emissions Trading Scheme (NZ ETS)
- Market-based tool: surrender 1 NZU per tonne CO₂e
- Covers: liquid fossil fuels (petrol, diesel), coal, industrial gases, waste, electricity generation
- NOT currently covering: agriculture biogenic methane
- Carbon price 2026: ~NZ$40–46/t spot; auction floor NZ$71/t
- A fleet operator buying 10,000 L diesel/year ≈ 26.8 tCO₂e ≈ NZ$1,200–2,000/yr carbon cost embedded in fuel

### Mandatory Climate-Related Disclosures (XRB NZ CS)
- Applies to ~200 large entities: listed issuers, large registered banks, large insurers
- Framework: NZ CS 1 (governance/strategy/risk), NZ CS 2 (principles/concepts), NZ CS 3 (assurance)
- From financial years starting 1 January 2023
- Most SMEs are NOT required to disclose — but doing so voluntarily is a procurement advantage

### Government Target 9 (Public Sector)
- Public sector agencies must reduce net emissions and report quarterly
- Government fleet carbon neutral target by 2025/26
- Quarterly progress reports published by MfE

### NZ Grid Electricity
- NZ is ~90%+ renewable (hydro, wind, geothermal)
- 2025 grid factor: 55 gCO₂e/kWh (MfE/EECA, down from 107 gCO₂e in 2015)
- A renewable electricity contract can reduce Scope 2 electricity CO₂e to 0 (market-based method, GHG Protocol)
- Grid trajectory: expected to improve further as more wind/solar comes online

### Toitū Certification Pathway (formerly CEMARS/carboNZero)
- Toitū carbonreduce: Measure & commit to reduce — ISO 14065 accredited, ~$3,000–8,000/yr
- Toitū net carbonzero: Full offsetting to neutrality — internationally recognised
- Both highly valued in NZ government and council tender evaluation
- EnviroIQ data is already in the correct format for Toitū certification submission

### NZ Fleet Benchmarks (MfE 2024 data)
- NZ light petrol: ~0.196 kg CO₂e/km
- NZ light diesel: ~0.214 kg CO₂e/km
- NZ EV (at 2025 grid): ~0.0085 kg CO₂e/km (Scope 2 only, 155 Wh/km average)
- Heavy truck (Hino 500-class): ~0.52 kg CO₂e/km
- Medium truck (Isuzu NPR-class): ~0.34 kg CO₂e/km

### Scope Definitions
- Scope 1: Direct combustion emissions (fleet fuel, gas boilers, site diesel)
- Scope 2: Purchased electricity (NZ grid factor or market-based renewable)
- Scope 3: Supply chain, business travel, purchased goods (not yet required by most NZ frameworks)

Always ground your advice in the organisation's actual data. Be specific, actionable, and reference NZ-specific tools and programmes. Quantify savings where possible. Format responses as structured JSON unless explicitly asked otherwise.
`.trim();

// ── Helper: gather org ESG context ───────────────────────────────────────────
async function gatherOrgContext(orgId: string) {
  const [org] = await db.execute<{ name: string; industry: string | null; esg_sustainability_score: number | null }>(
    sql`SELECT name, industry, esg_sustainability_score FROM organisations WHERE id = ${orgId} LIMIT 1`
  );
  if (!org) return null;

  const fleetRows = await db.execute<{ fuel_type: string; events: number; total_km: number; total_litres: number; total_co2e: number }>(
    sql`SELECT v.fuel_type, COUNT(*)::int as events, 
        ROUND(SUM(fe.distance_km)::numeric,1) as total_km,
        ROUND(SUM(fe.fuel_litres)::numeric,1) as total_litres,
        ROUND(SUM(fe.co2e_kg)::numeric,2) as total_co2e
      FROM fleet_events fe JOIN vehicles v ON fe.vehicle_id = v.id
      WHERE fe.organisation_id = ${orgId}
      GROUP BY v.fuel_type ORDER BY total_co2e DESC`
  );

  const vehicleRows = await db.execute<{ make: string; model: string; fuel_type: string; year: number | null; status: string }>(
    sql`SELECT make, model, fuel_type, year,
               CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status
        FROM vehicles WHERE organisation_id = ${orgId}
        ORDER BY is_active DESC, fuel_type`
  );

  const energyRows = await db.execute<{ utility_type: string; bills: number; total_kwh: number; total_mj: number; total_co2e: number }>(
    sql`SELECT utility_type, COUNT(*)::int as bills, 
        ROUND(SUM(usage_kwh)::numeric,1) as total_kwh,
        ROUND(SUM(usage_mj)::numeric,1) as total_mj,
        ROUND(SUM(co2e_kg)::numeric,2) as total_co2e
      FROM energy_readings WHERE organisation_id = ${orgId} GROUP BY utility_type ORDER BY total_co2e DESC`
  );

  const goalRows = await db.execute<{ title: string; status: string; target_value: number | null; target_unit: string | null; target_year: number | null }>(
    sql`SELECT title, status, target_value, target_unit, target_year
        FROM goals WHERE organisation_id = ${orgId}
        ORDER BY created_at DESC LIMIT 10`
  );

  const [gov] = await db.execute<{
    board_size: number | null; framework_alignment: string | null;
    has_tcfd_aligned: boolean | null; has_external_assurance: boolean | null;
    has_esg_risk_register: boolean | null;
  }>(
    sql`SELECT board_size, framework_alignment, has_tcfd_aligned, has_external_assurance, has_esg_risk_register
        FROM governance_snapshots WHERE organisation_id = ${orgId} ORDER BY created_at DESC LIMIT 1`
  );

  const totalFleetCo2 = (fleetRows as any[]).reduce((s: number, r: any) => s + parseFloat(r.total_co2e ?? 0), 0);
  const totalEnergyCo2 = (energyRows as any[]).reduce((s: number, r: any) => s + parseFloat(r.total_co2e ?? 0), 0);
  const totalCo2 = totalFleetCo2 + totalEnergyCo2;
  const totalFleetKm = (fleetRows as any[]).reduce((s: number, r: any) => s + parseFloat(r.total_km ?? 0), 0);
  const totalFleetLitres = (fleetRows as any[]).filter((r: any) => r.fuel_type !== "electric")
    .reduce((s: number, r: any) => s + parseFloat(r.total_litres ?? 0), 0);
  const hasEV = (fleetRows as any[]).some((r: any) => r.fuel_type === "electric");
  const evPct = hasEV
    ? Math.round(((vehicleRows as any[]).filter((r: any) => r.fuel_type === "electric").length / Math.max((vehicleRows as any[]).length, 1)) * 100)
    : 0;
  const electricityKwh = (energyRows as any[]).find((r: any) => r.utility_type === "electricity")?.total_kwh ?? 0;
  const hasGas = (energyRows as any[]).some((r: any) => r.utility_type === "gas");
  const etsCarbonCostNZD = Math.round(totalFleetLitres * 2.68 * 43);

  return {
    org,
    orgContext: {
      name: org.name,
      industry: org.industry,
      esgScore: org.esg_sustainability_score ?? null,
      fleet: fleetRows,
      vehicles: vehicleRows,
      energy: energyRows,
      goals: goalRows,
      governance: gov ?? null,
      totals: {
        fleetCo2eKg: Math.round(totalFleetCo2),
        energyCo2eKg: Math.round(totalEnergyCo2),
        totalCo2eKg: Math.round(totalCo2),
        totalCo2eTonnes: +(totalCo2 / 1000).toFixed(2),
        totalFleetKm: Math.round(totalFleetKm),
        totalFleetLitresNonEV: Math.round(totalFleetLitres),
        electricityKwh: Math.round(electricityKwh),
        hasEV,
        evFleetPct: evPct,
        hasGas,
        estimatedETSCarbonCostNZD: etsCarbonCostNZD,
        fleetScopePct: totalCo2 > 0 ? Math.round((totalFleetCo2 / totalCo2) * 100) : 0,
      },
    },
  };
}

// ── Helper: run the AI and return parsed insights ─────────────────────────────
async function generateInsights(orgContext: object) {
  const prompt = `
You are the EnviroIQ AI ESG Advisor. Analyse this New Zealand organisation's ESG data and generate a structured set of insights.

## Organisation Data
${JSON.stringify(orgContext, null, 2)}

## Instructions
Generate exactly this JSON structure (no markdown fences, pure JSON):

{
  "summary": "2-3 sentence plain English summary of their current ESG position",
  "complianceItems": [
    {
      "title": "string",
      "description": "string — specific to this org",
      "status": "required" | "recommended" | "not_applicable" | "achieved",
      "urgency": "immediate" | "this_year" | "monitor",
      "link": "https://... optional NZ govt URL"
    }
  ],
  "insights": [
    {
      "category": "fleet" | "energy" | "governance" | "certification" | "reporting" | "policy",
      "title": "string — specific, action-oriented",
      "body": "string — 2-4 sentences. Be quantitative. Use the actual data. Reference NZ-specific programmes.",
      "impact": "high" | "medium" | "low",
      "effort": "quick_win" | "medium_term" | "strategic",
      "saving_co2e_kg": number | null,
      "saving_nzd": number | null
    }
  ],
  "certificationPath": {
    "currentLevel": "none" | "carbonreduce" | "carbonzero",
    "nextStep": "string",
    "readinessScore": number (0-100),
    "gapsToAddress": ["string"]
  },
  "etsCarbonCost": {
    "estimatedAnnualNZD": number,
    "explanation": "string"
  },
  "timeline": [
    {
      "date": "string e.g. 'June 2026' or 'End of 2026'",
      "event": "string",
      "relevantToOrg": boolean
    }
  ]
}

Rules:
- complianceItems: include 4–6 items covering mandatory disclosures, ETS, ERP2, Target 9 (if public sector), Toitū
- insights: generate 5–8 insights. Each must reference their specific numbers.
- timeline: include 5–7 upcoming NZ climate policy dates
- Be direct and specific. Do not use generic advice.
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: NZ_POLICY_CONTEXT },
      { role: "user", content: prompt },
    ],
    max_completion_tokens: 3000,
  });

  const raw = completion.choices[0].message.content ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { error: "Failed to parse AI response" };
  }
}

// ── GET /insights — serve from cache only ────────────────────────────────────
router.get("/insights", requireAuth, requireOrgAccess, async (req: Request, res: Response) => {
  const { orgId } = req.params;

  try {
    const [cached] = await db.execute<{
      insights_json: string;
      org_context_json: string;
      generated_at: string;
    }>(
      sql`SELECT insights_json, org_context_json, generated_at FROM advisor_cache WHERE organisation_id = ${orgId} LIMIT 1`
    );

    if (!cached) {
      res.json({ data: null, orgContext: null, generatedAt: null });
      return;
    }

    res.json({
      data: JSON.parse(cached.insights_json),
      orgContext: JSON.parse(cached.org_context_json),
      generatedAt: cached.generated_at,
    });
  } catch (err) {
    req.log.error({ err }, "Advisor insights fetch failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load insights" });
  }
});

// ── POST /insights/regenerate — generate fresh AI insights and cache them ─────
router.post("/insights/regenerate", requireAuth, requireOrgAccess, async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const userId = (req as any).user?.id ?? null;

  try {
    const ctx = await gatherOrgContext(orgId);
    if (!ctx) { res.status(404).json({ error: "Organisation not found" }); return; }

    const { org, orgContext } = ctx;
    const parsed = await generateInsights(orgContext);

    // Upsert into cache (unique on organisation_id)
    await db.execute(
      sql`INSERT INTO advisor_cache (id, organisation_id, insights_json, org_context_json, generated_at, generated_by)
          VALUES (${randomUUID()}, ${orgId}, ${JSON.stringify(parsed)}, ${JSON.stringify({ name: org.name, totals: orgContext.totals })}, NOW(), ${userId})
          ON CONFLICT (organisation_id) DO UPDATE
            SET insights_json = EXCLUDED.insights_json,
                org_context_json = EXCLUDED.org_context_json,
                generated_at = EXCLUDED.generated_at,
                generated_by = EXCLUDED.generated_by`
    );

    const [saved] = await db.execute<{ generated_at: string }>(
      sql`SELECT generated_at FROM advisor_cache WHERE organisation_id = ${orgId} LIMIT 1`
    );

    res.json({
      data: parsed,
      orgContext: { name: org.name, totals: orgContext.totals },
      generatedAt: saved?.generated_at ?? new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Advisor regenerate failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to generate insights" });
  }
});

// ── POST /ask — Free-text Q&A with the NZ ESG Advisor ────────────────────────
const AskBody = z.object({
  question: z.string().min(3).max(1000),
});

router.post("/ask", requireAuth, requireOrgAccess, async (req: Request, res: Response) => {
  const { orgId } = req.params;

  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const { question } = parsed.data;

  try {
    const [org] = await db.execute<{ name: string; industry: string | null }>(
      sql`SELECT name, industry FROM organisations WHERE id = ${orgId} LIMIT 1`
    );

    const [snap] = await db.execute<{ fleet_co2: number; energy_co2: number }>(
      sql`SELECT 
          COALESCE((SELECT SUM(co2e_kg) FROM fleet_events WHERE organisation_id = ${orgId}),0)::float as fleet_co2,
          COALESCE((SELECT SUM(co2e_kg) FROM energy_readings WHERE organisation_id = ${orgId}),0)::float as energy_co2`
    );

    const contextMsg = `Organisation: ${org?.name ?? "Unknown"} (${org?.industry ?? "unspecified industry"})
Scope 1 fleet CO₂e: ${((snap as any)?.fleet_co2 / 1000).toFixed(2)} t
Scope 2 energy CO₂e: ${((snap as any)?.energy_co2 / 1000).toFixed(2)} t
Total: ${(((snap as any)?.fleet_co2 + (snap as any)?.energy_co2) / 1000).toFixed(2)} t`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: `${NZ_POLICY_CONTEXT}\n\n## Organisation Context\n${contextMsg}\n\nAnswer questions clearly, in plain English, with specific NZ references. Keep answers under 250 words.` },
        { role: "user", content: question },
      ],
      max_completion_tokens: 600,
    });

    res.json({ answer: completion.choices[0].message.content ?? "No answer generated." });
  } catch (err) {
    req.log.error({ err }, "Advisor ask failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get answer" });
  }
});

export default router;
