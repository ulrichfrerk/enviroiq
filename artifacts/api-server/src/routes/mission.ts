import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { z } from "zod";

const router = Router({ mergeParams: true });

const GenerateBody = z.object({
  tone: z.enum(["professional", "ambitious", "concise"]).default("professional"),
  focusAreas: z.array(z.string()).optional(),
  customContext: z.string().max(500).optional(),
});

router.post("/generate", requireAuth, requireOrgAccess, async (req: Request, res: Response) => {
  const { orgId } = req.params;

  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { tone, focusAreas, customContext } = parsed.data;

  // ── Gather org context ────────────────────────────────────────────────────
  const [org] = await db.execute<{
    name: string; industry: string | null; slug: string;
  }>(sql`SELECT name, industry, slug FROM organisations WHERE id = ${orgId} LIMIT 1`);

  const [emissionsRow] = await db.execute<{
    total_co2e_kg: string | null;
    fleet_co2e_kg: string | null;
    energy_co2e_kg: string | null;
    vehicle_count: string;
  }>(sql`
    SELECT
      (SELECT COALESCE(SUM(co2e_kg),0) FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at > NOW() - INTERVAL '12 months') +
      (SELECT COALESCE(SUM(co2e_kg),0) FROM energy_bills WHERE organisation_id = ${orgId} AND bill_date > NOW() - INTERVAL '12 months')
        AS total_co2e_kg,
      (SELECT COALESCE(SUM(co2e_kg),0) FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at > NOW() - INTERVAL '12 months') AS fleet_co2e_kg,
      (SELECT COALESCE(SUM(co2e_kg),0) FROM energy_bills WHERE organisation_id = ${orgId} AND bill_date > NOW() - INTERVAL '12 months') AS energy_co2e_kg,
      (SELECT COUNT(*) FROM vehicles WHERE organisation_id = ${orgId} AND status = 'active') AS vehicle_count
  `);

  const targets = await db.execute<{
    label: string | null; target_year: number; target_pct_reduction: number; framework: string | null;
  }>(sql`
    SELECT label, target_year, target_pct_reduction, framework
    FROM emission_targets
    WHERE organisation_id = ${orgId}
    ORDER BY target_year ASC
    LIMIT 5
  `);

  // Build maturity score from 4 dimensions dynamically (same logic as maturity route)
  const vehicleCount = parseInt((emissionsRow?.vehicle_count ?? "0"));
  const totalCo2eKg = parseFloat((emissionsRow?.total_co2e_kg ?? "0"));
  const [billCount] = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM energy_bills WHERE organisation_id = ${orgId}`
  );
  const [targetCount] = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM emission_targets WHERE organisation_id = ${orgId}`
  );
  const [auditCount] = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM audit_logs WHERE organisation_id = ${orgId}`
  );

  const numBills = parseInt(billCount?.cnt ?? "0");
  const numTargets = parseInt(targetCount?.cnt ?? "0");
  const numAuditLogs = parseInt(auditCount?.cnt ?? "0");

  const foundationScore = Math.min(40, (vehicleCount > 0 ? 10 : 0) + (numBills > 0 ? 10 : 0) + (totalCo2eKg > 0 ? 20 : 0));
  const coverageScore = Math.min(30, (vehicleCount >= 5 ? 15 : vehicleCount > 0 ? 8 : 0) + (numBills >= 5 ? 15 : numBills > 0 ? 8 : 0));
  const qualityScore = Math.min(20, (totalCo2eKg > 0 && vehicleCount > 0 ? 10 : 0) + (numBills > 5 ? 10 : numBills > 0 ? 5 : 0));
  const governanceScore = Math.min(10, (numTargets > 0 ? 5 : 0) + (numAuditLogs > 20 ? 5 : numAuditLogs > 0 ? 2 : 0));
  const maturityTotal = foundationScore + coverageScore + qualityScore + governanceScore;
  const maturityGrade = maturityTotal >= 80 ? "Leader" : maturityTotal >= 55 ? "Advanced" : maturityTotal >= 30 ? "Developing" : "Foundation";

  // ── Build prompt ──────────────────────────────────────────────────────────
  const orgName = org?.name ?? "Our Organisation";
  const totalT = (totalCo2eKg / 1000).toFixed(1);
  const fleetT = (parseFloat(emissionsRow?.fleet_co2e_kg ?? "0") / 1000).toFixed(1);
  const energyT = (parseFloat(emissionsRow?.energy_co2e_kg ?? "0") / 1000).toFixed(1);

  const targetsText = targets.length > 0
    ? targets.map(t =>
        `- ${t.label || `Reduce emissions ${t.target_pct_reduction}%`} by ${t.target_year}${t.framework ? ` (${t.framework})` : ""}`
      ).join("\n")
    : "No formal targets yet set.";

  const toneGuide = {
    professional: "Write in a clear, measured, corporate tone. Suitable for tender submissions and board documents.",
    ambitious: "Write in an inspiring, forward-looking tone that conveys genuine leadership and urgency. Suitable for marketing websites.",
    concise: "Write in tight, punchy language. Three or four crisp sentences max. No fluff.",
  }[tone];

  const focusText = focusAreas?.length
    ? `\nEmphasise these focus areas: ${focusAreas.join(", ")}.`
    : "";

  const customText = customContext ? `\nAdditional context provided by the company: ${customContext}` : "";

  const systemPrompt = `You are an expert ESG consultant helping New Zealand organisations craft compelling sustainability mission statements for tenders, websites, and board reports. Your statements must be grounded in real data and avoid greenwashing. Do not invent statistics — only use the exact figures provided.`;

  const userPrompt = `
Write an ESG sustainability mission statement for **${orgName}**.

${toneGuide}${focusText}${customText}

**Verified emissions data (last 12 months):**
- Total CO₂e: ${totalT} tonnes
- Fleet (Scope 1): ${fleetT} tonnes CO₂e from ${vehicleCount} active vehicles
- Energy (Scope 2): ${energyT} tonnes CO₂e
- ESG Maturity grade: ${maturityGrade} (${maturityTotal}/100)

**Emission reduction targets:**
${targetsText}

**Requirements:**
- 2–4 paragraphs (or 3–4 sentences if concise tone)
- Reference the specific emissions data and targets where natural
- Align with NZ's net zero 2050 goal
- Mention commitment to MfE measurement methodology and transparency where appropriate
- End with a forward-looking commitment statement
- Do NOT use generic filler phrases ("we are committed to a greener future")
- Output plain text only — no markdown headers or bullet points in the statement itself
`.trim();

  // ── Stream response ───────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
