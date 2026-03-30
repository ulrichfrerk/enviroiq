import {
  db,
  organisationsTable,
  usersTable,
  vehiclesTable,
  fleetEventsTable,
  energyReadingsTable,
  goalsTable,
  widgetConfigsTable,
  reportsTable,
} from "@workspace/db";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding EnviroIQ database...");

  // 1. Super Admin
  const superAdminId = uuidv4();
  const [existingSuperAdmin] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "admin@enviroiq.app"));

  let superAdmin: any;
  if (!existingSuperAdmin) {
    [superAdmin] = await db
      .insert(usersTable)
      .values({
        id: superAdminId,
        email: "admin@enviroiq.app",
        name: "EnviroIQ Super Admin",
        role: "super_admin",
        organisationId: null,
      })
      .returning();
    console.log("✅ Created super admin: admin@enviroiq.app");
  } else {
    superAdmin = existingSuperAdmin;
    console.log("ℹ️  Super admin already exists");
  }

  // 2. Demo Organisation
  const orgSlug = "acme-logistics";
  const [existingOrg] = await db
    .select()
    .from(organisationsTable)
    .where(eq(organisationsTable.slug, orgSlug));

  let org: any;
  if (!existingOrg) {
    const orgId = uuidv4();
    const widgetKey = `wk_${uuidv4().replace(/-/g, "").substring(0, 24)}`;
    const inboundEmail = `${orgSlug}-${uuidv4().substring(0, 8)}@bills.enviroiq.app`;

    [org] = await db
      .insert(organisationsTable)
      .values({
        id: orgId,
        name: "Acme Logistics Ltd",
        slug: orgSlug,
        industry: "logistics",
        country: "NZ",
        widgetKey,
        inboundEmailAddress: inboundEmail,
      })
      .returning();
    console.log(`✅ Created organisation: Acme Logistics Ltd (${orgId})`);

    // Create default widget config
    await db.insert(widgetConfigsTable).values({ organisationId: orgId }).onConflictDoNothing();
  } else {
    org = existingOrg;
    console.log("ℹ️  Organisation already exists");
  }

  // 3. Org Admin User
  const [existingOrgAdmin] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "sarah@acmelogistics.co.nz"));

  let orgAdmin: any;
  if (!existingOrgAdmin) {
    [orgAdmin] = await db
      .insert(usersTable)
      .values({
        id: uuidv4(),
        email: "sarah@acmelogistics.co.nz",
        name: "Sarah Chen",
        role: "org_admin",
        organisationId: org.id,
      })
      .returning();
    console.log("✅ Created org admin: sarah@acmelogistics.co.nz");
  } else {
    orgAdmin = existingOrgAdmin;
  }

  // 4. Org Viewer User
  const [existingViewer] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "james@acmelogistics.co.nz"));

  if (!existingViewer) {
    await db.insert(usersTable).values({
      id: uuidv4(),
      email: "james@acmelogistics.co.nz",
      name: "James Park",
      role: "org_viewer",
      organisationId: org.id,
    });
    console.log("✅ Created viewer: james@acmelogistics.co.nz");
  }

  // 5. Vehicles
  const [existingVehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.organisationId, org.id));

  const vehicleIds: string[] = [];
  if (!existingVehicle) {
    const vehicles = [
      { name: "Truck Alpha", registration: "ABC-123", make: "Isuzu", model: "NPR", fuelType: "diesel", gpsProvider: "navman" },
      { name: "Truck Beta", registration: "DEF-456", make: "Hino", model: "500", fuelType: "diesel", gpsProvider: "blackhawk" },
      { name: "Van Gamma", registration: "GHI-789", make: "Ford", model: "Transit", fuelType: "petrol", gpsProvider: "navman" },
      { name: "EV Delta", registration: "JKL-012", make: "BYD", model: "T3", fuelType: "electric", gpsProvider: "generic" },
    ];

    for (const v of vehicles) {
      const id = uuidv4();
      vehicleIds.push(id);
      await db.insert(vehiclesTable).values({
        id,
        organisationId: org.id,
        name: v.name,
        registration: v.registration,
        make: v.make,
        model: v.model,
        fuelType: v.fuelType as any,
        gpsProvider: v.gpsProvider as any,
        isActive: true,
      });
    }
    console.log(`✅ Created ${vehicles.length} vehicles`);
  } else {
    const allVehicles = await db.select().from(vehiclesTable).where(eq(vehiclesTable.organisationId, org.id));
    vehicleIds.push(...allVehicles.map(v => v.id));
    console.log("ℹ️  Vehicles already exist");
  }

  // 6. Fleet Events (last 30 days)
  const [existingEvent] = await db.select().from(fleetEventsTable).where(eq(fleetEventsTable.organisationId, org.id));

  if (!existingEvent && vehicleIds.length > 0) {
    const emissionFactors: Record<string, number> = {
      diesel: 2.68,
      petrol: 2.31,
      electric: 0,
    };

    const events = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const vehicleId = vehicleIds[i % vehicleIds.length];
      const fuelLitres = Math.round((20 + Math.random() * 80) * 10) / 10;
      const distanceKm = Math.round((50 + Math.random() * 200) * 10) / 10;
      const fuelType = i % 4 === 3 ? "electric" : i % 4 === 2 ? "petrol" : "diesel";
      const co2eKg = fuelLitres * (emissionFactors[fuelType] || 2.68);

      events.push({
        id: uuidv4(),
        organisationId: org.id,
        vehicleId,
        eventType: "journey" as const,
        recordedAt: date,
        fuelLitres,
        distanceKm,
        fuelType: fuelType as any,
        co2eKg,
        source: i % 2 === 0 ? "navman" : "blackhawk",
      });
    }

    await db.insert(fleetEventsTable).values(events);
    console.log(`✅ Created ${events.length} fleet events`);
  }

  // 7. Energy Readings (last 6 months)
  const [existingReading] = await db.select().from(energyReadingsTable).where(eq(energyReadingsTable.organisationId, org.id));

  if (!existingReading) {
    const readings = [];
    for (let i = 0; i < 6; i++) {
      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() - i, 0);
      const periodStart = new Date(now.getFullYear(), now.getMonth() - i - 1, 1);
      const usageKwh = Math.round(3000 + Math.random() * 2000);
      const co2eKg = usageKwh * 0.0977;

      readings.push({
        id: uuidv4(),
        organisationId: org.id,
        utilityType: "electricity" as const,
        provider: "Vector Energy",
        periodStart,
        periodEnd,
        usageKwh,
        costAmount: Math.round(usageKwh * 0.28 * 100) / 100,
        costCurrency: "NZD",
        co2eKg,
        source: "manual" as const,
      });
    }

    // Gas readings
    for (let i = 0; i < 6; i++) {
      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() - i, 0);
      const periodStart = new Date(now.getFullYear(), now.getMonth() - i - 1, 1);
      const usageMj = Math.round(500 + Math.random() * 300);
      const co2eKg = usageMj * 0.0535;

      readings.push({
        id: uuidv4(),
        organisationId: org.id,
        utilityType: "gas" as const,
        provider: "Genesis Energy",
        periodStart,
        periodEnd,
        usageMj,
        costAmount: Math.round(usageMj * 0.05 * 100) / 100,
        costCurrency: "NZD",
        co2eKg,
        source: "manual" as const,
      });
    }

    await db.insert(energyReadingsTable).values(readings);
    console.log(`✅ Created ${readings.length} energy readings`);
  }

  // 8. Sustainability Goals
  const [existingGoal] = await db.select().from(goalsTable).where(eq(goalsTable.organisationId, org.id));

  if (!existingGoal) {
    const goals = [
      {
        title: "Net Zero by 2030",
        category: "emissions" as const,
        targetType: "reduce_to_absolute" as const,
        targetValue: 0,
        targetUnit: "kg CO2e",
        dueDate: new Date("2030-12-31"),
        status: "on_track" as const,
      },
      {
        title: "Reduce Fleet Emissions by 30%",
        category: "fleet" as const,
        targetType: "reduce_by_percent" as const,
        targetValue: 30,
        targetUnit: "%",
        dueDate: new Date("2026-12-31"),
        status: "on_track" as const,
      },
      {
        title: "Switch to 100% Renewable Energy",
        category: "energy" as const,
        targetType: "reduce_by_percent" as const,
        targetValue: 100,
        targetUnit: "%",
        dueDate: new Date("2027-06-30"),
        status: "behind" as const,
      },
    ];

    for (const g of goals) {
      await db.insert(goalsTable).values({
        id: uuidv4(),
        organisationId: org.id,
        createdBy: orgAdmin.id,
        ...g,
      });
    }
    console.log(`✅ Created ${goals.length} sustainability goals`);
  }

  // 9. Sample Reports
  const [existingReport] = await db.select().from(reportsTable).where(eq(reportsTable.organisationId, org.id));

  if (!existingReport) {
    await db.insert(reportsTable).values({
      id: uuidv4(),
      organisationId: org.id,
      title: "Q4 2025 ESG Board Summary",
      reportType: "board_summary",
      periodStart: new Date("2025-10-01"),
      periodEnd: new Date("2025-12-31"),
      status: "ready",
      createdBy: orgAdmin.id,
    });
    console.log("✅ Created sample report");
  }

  console.log("\n✨ Seed complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 Super Admin: admin@enviroiq.app");
  console.log("📧 Org Admin:   sarah@acmelogistics.co.nz");
  console.log("📧 Viewer:      james@acmelogistics.co.nz");
  console.log("🏢 Organisation: Acme Logistics Ltd");
  console.log("🔑 Use 'Continue with Email' then request a magic link to log in");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
