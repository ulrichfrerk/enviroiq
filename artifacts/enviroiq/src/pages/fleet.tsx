import { useState, useRef, useEffect } from "react";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";
import { useAuth } from "@/hooks/use-auth";
import {
  useListVehicles,
  useCreateVehicle,
  useDeleteVehicle,
  CreateVehicleRequestFuelType,
  CreateVehicleRequestGpsProvider,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Car, Plus, Trash2, Loader2, Navigation, Server, Upload, Download,
  CheckCircle2, XCircle, Gauge, FileSpreadsheet, AlertTriangle, Search, Star,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

type ImportState = "idle" | "preview" | "importing" | "done";
export type KmRow = { vehicle: string; date: string; distanceKm: string; fuelLitres?: string };
type VehicleImportRow = {
  name: string;
  registration?: string;
  make?: string;
  model?: string;
  fuelType: string;
  gpsProvider: string;
  gpsDeviceId?: string;
  fleet?: string;       // TN360 fleet group — shown in preview only
  hasGps?: boolean;     // whether TN360 marks this as GPS-tracked
  skip?: boolean;       // Z-History / retired flag
};

// ─── Fuel type detection ─────────────────────────────────────────────────────

function detectFuelType(make = "", model = ""): string {
  const t = `${make} ${model}`.toLowerCase();
  if (/\bev\b|electric|bev|ioniq|leaf|model\s[s3xy]|e-tron/.test(t)) return "electric";
  if (/hybrid/.test(t)) return "hybrid";
  if (/lpg|\bgas\b|autogas/.test(t)) return "lpg";
  if (/petrol|unleaded|efi|gsr|\b1\.[3458]\b/.test(t)) return "petrol";
  // Diesel clues common in NZ commercial fleet
  if (/diesel|\bdt\b|\btd\b|\btdi\b|turbo.d|dutro|hino|isuzu|scania|mitsubishi fuso|cdtdi|cdi|3\.0|2\.8|2\.5l/.test(t)) return "diesel";
  // Default to diesel — NZ commercial fleet is predominantly diesel
  return "diesel";
}

// ─── XLSX / CSV vehicle parser ────────────────────────────────────────────────

function parseTN360VehicleSheet(rows: unknown[][]): VehicleImportRow[] {
  // Row 0: "Vehicle Summary Report (N results)" — skip
  // Row 2: header row  — columns: Vehicle, Vehicle Type, Make, Model, Fleet, Registration, ..., Source
  const header = (rows[2] as (string | null)[]).map(h => (h ?? "").toLowerCase().trim());
  const COL = (names: string[]) => names.reduce((found, n) => found !== -1 ? found : header.indexOf(n), -1);

  const vCol    = COL(["vehicle", "name", "asset"]);
  const regoCol = COL(["registration"]);
  const makeCol = COL(["make"]);
  const modelCol = COL(["model"]);
  const fleetCol = COL(["fleet"]);
  const srcCol  = COL(["source"]);
  const typeCol = COL(["vehicle type"]);

  const out: VehicleImportRow[] = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i] as (string | number | null)[];
    const name = String(row[vCol] ?? "").trim();
    if (!name) continue;
    const fleet    = fleetCol >= 0 ? String(row[fleetCol] ?? "").trim() : "";
    const isZHist  = fleet === "Z-History";
    const source   = srcCol >= 0 ? String(row[srcCol] ?? "").trim() : "";
    const make     = makeCol >= 0  ? String(row[makeCol]  ?? "").trim() : "";
    const model    = modelCol >= 0 ? String(row[modelCol] ?? "").trim() : "";
    const rego     = regoCol >= 0  ? String(row[regoCol]  ?? "").trim() : "";
    const vType    = typeCol >= 0  ? String(row[typeCol]  ?? "").trim() : "";

    out.push({
      name,
      registration: rego || name,
      make: make || undefined,
      model: model || undefined,
      fuelType: detectFuelType(make, model),
      gpsProvider: source === "GPS" ? "generic" : "none",
      fleet: fleet || undefined,
      hasGps: source === "GPS",
      skip: isZHist,
      // Store vType in model if no model available
      ...((!model && vType) ? { model: vType } : {}),
    });
  }
  return out;
}

function parseVehicleFile(file: File): Promise<{ rows: VehicleImportRow[]; errors: string[]; source: "tn360" | "csv" }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const ab = e.target?.result;
      if (!ab) { resolve({ rows: [], errors: ["Could not read file"], source: "csv" }); return; }

      // Check if this is an XLSX file
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".xlsm")) {
        try {
          const wb = xlsxRead(ab, { type: "array" });
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const raw = xlsxUtils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
          // Detect TN360 Vehicle Summary Report
          const firstCell = String(raw[0]?.[0] ?? "");
          if (firstCell.includes("Vehicle Summary Report")) {
            const rows = parseTN360VehicleSheet(raw);
            resolve({ rows, errors: [], source: "tn360" });
          } else {
            // Generic XLSX — treat first row as header
            const header = (raw[0] as (string | null)[]).map(h => (h ?? "").toLowerCase().trim());
            const vCol = header.indexOf("name");
            const ftCol = header.indexOf("fueltype") !== -1 ? header.indexOf("fueltype") : header.indexOf("fuel type");
            if (vCol === -1 || ftCol === -1) {
              resolve({ rows: [], errors: ["Could not find required columns 'name' and 'fuelType' in this spreadsheet. Use the template for guidance."], source: "csv" });
              return;
            }
            const rows: VehicleImportRow[] = [];
            for (let i = 1; i < raw.length; i++) {
              const row = raw[i] as (string | null)[];
              const name = String(row[vCol] ?? "").trim();
              if (!name) continue;
              rows.push({
                name,
                registration: String(row[header.indexOf("registration")] ?? "").trim() || undefined,
                make: String(row[header.indexOf("make")] ?? "").trim() || undefined,
                model: String(row[header.indexOf("model")] ?? "").trim() || undefined,
                fuelType: String(row[ftCol] ?? "diesel").trim() || "diesel",
                gpsProvider: String(row[header.indexOf("gpsprovider")] ?? "none").trim() || "none",
              });
            }
            resolve({ rows, errors: [], source: "csv" });
          }
        } catch (err) {
          resolve({ rows: [], errors: [`Failed to read Excel file: ${err instanceof Error ? err.message : String(err)}`], source: "csv" });
        }
        return;
      }

      // CSV fallback
      const text = new TextDecoder().decode(ab as ArrayBuffer);
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { resolve({ rows: [], errors: ["CSV must have a header row and at least one data row."], source: "csv" }); return; }
      const header = lines[0].split(",").map(h => h.trim().toLowerCase());
      const errors: string[] = [];
      if (!header.includes("name")) errors.push("Missing required column: 'name'");
      if (!header.includes("fueltype")) errors.push("Missing required column: 'fuelType'");
      if (errors.length) { resolve({ rows: [], errors, source: "csv" }); return; }
      const rows: VehicleImportRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const vals = line.split(",").map(v => v.trim());
        const get = (col: string) => vals[header.indexOf(col)] ?? "";
        const name = get("name");
        if (!name) { errors.push(`Row ${i}: name is required`); continue; }
        rows.push({
          name,
          registration: get("registration") || undefined,
          make: get("make") || undefined,
          model: get("model") || undefined,
          fuelType: get("fueltype") || "diesel",
          gpsProvider: get("gpsprovider") || "none",
          gpsDeviceId: get("gpsdeviceid") || undefined,
        });
      }
      resolve({ rows, errors, source: "csv" });
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── KM import: TN360 Distance Trip Report (XLSX) ────────────────────────────

const TN360_MONTHS: Record<string, string> = {
  Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
  Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
};

function parseTN360TripDate(raw: string): string | null {
  // "04 Jan 2026 12:52:28 PM" → "2026-01-04"
  const m = String(raw).match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return null;
  const mon = TN360_MONTHS[m[2]];
  return mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
}

export type KmImportMeta = {
  source: "tn360-trip" | "csv";
  vehicles?: number;
  records?: number;
  period?: string;
  skippedTrips?: number;
};

function parseTN360TripReport(data: unknown[][]): { rows: KmRow[]; errors: string[]; meta: KmImportMeta } {
  // Row 0: "Distance Trip Report (N results)"
  // Row 2: ["Time Period:", "…"]
  // Row 4: header row
  const period = data[2]?.[1] ? String(data[2][1]).trim() : undefined;
  const header = (data[4] ?? []) as (string | null)[];

  const vCol    = header.indexOf("Vehicle");
  const dateCol = header.indexOf("Start Time");
  const distCol = header.indexOf("Distance Travelled (km)");
  const plausCol = header.indexOf("Plausible");
  const fuelCol  = header.indexOf("Fuel Used (L)");

  if (vCol === -1 || dateCol === -1 || distCol === -1) {
    return { rows: [], errors: ["Could not find required columns in the TN360 Distance Trip Report."], meta: { source: "tn360-trip" } };
  }

  // Aggregate by vehicle + date
  const daily = new Map<string, { vehicle: string; date: string; distanceKm: number; fuelLitres: number }>();
  let skippedTrips = 0;

  for (let i = 5; i < data.length; i++) {
    const row = data[i] as (string | number | null)[];
    if (!row?.[0]) continue;

    // Skip implausible trips
    const plaus = plausCol >= 0 ? row[plausCol] : 1;
    if (plaus !== null && Number(plaus) === 0) { skippedTrips++; continue; }

    const dist = Number(row[distCol]);
    if (!dist || dist <= 0) continue;

    const vehicle = String(row[vCol] ?? "").trim();
    if (!vehicle) continue;

    const date = parseTN360TripDate(String(row[dateCol] ?? ""));
    if (!date) { skippedTrips++; continue; }

    const fuel = fuelCol >= 0 ? Number(row[fuelCol]) || 0 : 0;
    const key = `${vehicle}|${date}`;
    const existing = daily.get(key);
    if (existing) {
      existing.distanceKm += dist;
      existing.fuelLitres  += fuel;
    } else {
      daily.set(key, { vehicle, date, distanceKm: dist, fuelLitres: fuel });
    }
  }

  const rows: KmRow[] = [...daily.values()].map(r => ({
    vehicle: r.vehicle,
    date: r.date,
    distanceKm: r.distanceKm.toFixed(2),
    fuelLitres: r.fuelLitres > 0 ? r.fuelLitres.toFixed(2) : undefined,
  }));

  const vehicles = new Set(rows.map(r => r.vehicle)).size;
  const errors: string[] = [];
  if (skippedTrips > 0) errors.push(`${skippedTrips.toLocaleString()} trips skipped (implausible GPS or missing date) — daily totals are unaffected.`);

  return {
    rows,
    errors,
    meta: { source: "tn360-trip", vehicles, records: rows.length, period, skippedTrips },
  };
}

// ─── KM CSV templates & parser ─────────────────────────────────────────────

const KM_TEMPLATE = [
  "vehicle,date,distance_km,fuel_litres",
  "Truck 01,15/01/2025,145.3,12.5",
  "Van 02,15/01/2025,87.2,",
].join("\n");

const COL_VEHICLE  = ["vehicle", "vehicle name", "asset", "name", "unit", "rego", "registration", "vehicle/asset"];
const COL_DATE     = ["date", "trip date", "start date", "day", "report date"];
const COL_DISTANCE = ["distance_km", "distance (km)", "distance", "kms", "km", "total distance", "odometer", "total kms", "distance km"];
const COL_FUEL     = ["fuel_litres", "fuel (l)", "fuel used (l)", "fuel", "litres", "fuel used", "fuel consumed", "fuel (litres)"];

function findCol(header: string[], aliases: string[]): number {
  return aliases.reduce((found, a) => found !== -1 ? found : header.indexOf(a), -1);
}

function parseKmCSV(text: string): { rows: KmRow[]; errors: string[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], errors: ["CSV must have a header row and at least one data row."] };
  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
  const vCol = findCol(header, COL_VEHICLE);
  const dCol = findCol(header, COL_DATE);
  const kmCol = findCol(header, COL_DISTANCE);
  const errors: string[] = [];
  if (vCol === -1) errors.push(`No vehicle column — expected one of: ${COL_VEHICLE.slice(0, 4).join(", ")}`);
  if (dCol === -1) errors.push(`No date column — expected one of: ${COL_DATE.slice(0, 3).join(", ")}`);
  if (kmCol === -1) errors.push(`No distance column — expected one of: ${COL_DISTANCE.slice(0, 4).join(", ")}`);
  if (errors.length) return { rows: [], errors };
  const fuelCol = findCol(header, COL_FUEL);
  const rows: KmRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
    const vehicle = vals[vCol!] || "";
    const date = vals[dCol!] || "";
    const distanceKm = vals[kmCol!] || "";
    const fuelLitres = fuelCol !== -1 ? vals[fuelCol] || undefined : undefined;
    if (!vehicle) { errors.push(`Row ${i}: vehicle name is empty`); continue; }
    if (!distanceKm || isNaN(Number(distanceKm))) { errors.push(`Row ${i} (${vehicle}): invalid distance "${distanceKm}"`); continue; }
    rows.push({ vehicle, date, distanceKm, fuelLitres: fuelLitres || undefined });
  }
  return { rows, errors };
}

// ─── Fuelsaver plate lookup ───────────────────────────────────────────────────

type PlateLookupResult =
  | { found: false; configured?: boolean; errorCode?: string }
  | {
      found: true;
      plate: string;
      make: string | null;
      model: string | null;
      subModel: string | null;
      fuelType: string;
      co2GPerKm: number;
      co2Stars: number | null;
      fuelL100km: string | null;
      emissionFactorKgPerKm: number;
      yearlyTonnes: number | null;
      annualCostNzd: string | null;
    };

// ─── Form schema ─────────────────────────────────────────────────────────────

const vehicleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  registration: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  fuelType: z.enum(["petrol", "diesel", "electric", "hybrid", "lpg", "hydrogen", "other"]),
  gpsProvider: z.enum(["navman", "blackhawk", "generic", "none"]),
  gpsDeviceId: z.string().optional(),
});

// ─── Vehicle stats (top emitters) ────────────────────────────────────────────

type VehicleStat = {
  vehicleId: string;
  name: string;
  make: string | null;
  model: string | null;
  fuelType: string;
  emissionFactorKgPerKm: number | null;
  classEmissionFactorKgPerKm: number | null;
  effectiveEmissionFactor: number | null;
  totalKm: number;
  totalCo2eKg: number;
  eventCount: number;
  avgDailyKm: number;
  co2ePerKm: number;
};

function useVehicleStats(orgId: string | undefined) {
  const [data, setData] = useState<VehicleStat[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    fetch(`/api/organisations/${orgId}/fleet/vehicles/stats`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [orgId]);
  return { stats: data, loadingStats: loading };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Fleet() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();

  // Vehicle import state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [importRows, setImportRows] = useState<VehicleImportRow[]>([]);
  const [includeZHistory, setIncludeZHistory] = useState(false);
  const [importSource, setImportSource] = useState<"tn360" | "csv">("csv");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ ok: number; failed: number }>({ ok: 0, failed: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // KM import state
  const [isKmImportOpen, setIsKmImportOpen] = useState(false);
  const [kmImportState, setKmImportState] = useState<ImportState>("idle");
  const [kmRows, setKmRows] = useState<KmRow[]>([]);
  const [kmErrors, setKmErrors] = useState<string[]>([]);
  const [kmProgress, setKmProgress] = useState(0);
  const [kmMeta, setKmMeta] = useState<KmImportMeta | null>(null);
  const [kmResults, setKmResults] = useState<{ imported: number; created: string[]; errors: string[] }>({ imported: 0, created: [], errors: [] });
  const kmFileInputRef = useRef<HTMLInputElement>(null);

  const { data: vehicles, isLoading, refetch } = useListVehicles(orgId!, { query: { enabled: !!orgId } });
  const createVehicle = useCreateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const { stats: vehicleStats, loadingStats } = useVehicleStats(orgId);

  // ── Fuelsaver plate lookup state ──────────────────────────────────────────
  const [plateLookup, setPlateLookup] = useState<PlateLookupResult | null>(null);
  const [plateLookupLoading, setPlateLookupLoading] = useState(false);

  const lookupPlate = async (plate: string) => {
    const p = plate.trim().replace(/\s+/g, "").toUpperCase();
    if (!p || p.length < 2 || !orgId) return;
    setPlateLookupLoading(true);
    setPlateLookup(null);
    try {
      const res = await fetch(`/app/api/organisations/${orgId}/fleet/vehicles/lookup-plate?plate=${encodeURIComponent(p)}`, { credentials: "include" });
      const json = await res.json() as PlateLookupResult;
      setPlateLookup(json);
      if (json.found) {
        if (json.fuelType) form.setValue("fuelType", json.fuelType as z.infer<typeof vehicleSchema>["fuelType"]);
        if (json.make)    form.setValue("make", json.make);
        if (json.model) {
          const fullModel = [json.model, json.subModel].filter(Boolean).join(" ");
          form.setValue("model", fullModel);
        }
        if (!form.getValues("name")) {
          form.setValue("name", [json.make, json.model].filter(Boolean).join(" ") || p);
        }
      }
    } catch {
      setPlateLookup({ found: false });
    } finally {
      setPlateLookupLoading(false);
    }
  };

  const knownVehicles = new Set([
    ...(vehicles?.items.map(v => v.name.toLowerCase().trim()) ?? []),
    ...(vehicles?.items.filter(v => v.registration).map(v => v.registration!.toLowerCase().trim()) ?? []),
  ]);

  // ─── Vehicle import handlers ────────────────────────────────────────────────

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { rows, errors, source } = await parseVehicleFile(file);
    setImportRows(rows);
    setImportErrors(errors);
    setImportSource(source);
    setImportState("preview");
  };

  const activeImportRows = importRows.filter(r => !r.skip || includeZHistory);

  const handleImport = async () => {
    if (!orgId || !activeImportRows.length) return;
    setImportState("importing");
    let ok = 0, failed = 0;
    for (let i = 0; i < activeImportRows.length; i++) {
      const row = activeImportRows[i];
      try {
        await createVehicle.mutateAsync({
          orgId,
          data: {
            name: row.name,
            registration: row.registration || undefined,
            make: row.make || undefined,
            model: row.model || undefined,
            fuelType: row.fuelType as CreateVehicleRequestFuelType,
            gpsProvider: (row.gpsProvider || "none") as CreateVehicleRequestGpsProvider,
            gpsDeviceId: row.gpsDeviceId || undefined,
          },
        });
        ok++;
      } catch {
        failed++;
      }
      setImportProgress(Math.round(((i + 1) / activeImportRows.length) * 100));
    }
    setImportResults({ ok, failed });
    setImportState("done");
    refetch();
  };

  const resetImport = () => {
    setImportState("idle");
    setImportRows([]);
    setImportErrors([]);
    setImportProgress(0);
    setImportResults({ ok: 0, failed: 0 });
    setIncludeZHistory(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadCsvTemplate = () => {
    const csv = "name,registration,make,model,fuelType,gpsProvider,gpsDeviceId\nTruck 01,ABC123,Ford,Ranger,diesel,navman,DEV-001\nVan 02,XYZ789,Toyota,HiAce,diesel,none,";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "vehicles-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── KM import handlers ─────────────────────────────────────────────────────

  const handleKmFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (/\.xlsx?$/i.test(file.name)) {
      // XLSX path — TN360 Distance Trip Report
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const ab = ev.target?.result as ArrayBuffer;
          const wb = xlsxRead(ab, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = xlsxUtils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
          const firstCell = String(raw[0]?.[0] ?? "");
          if (firstCell.includes("Distance Trip Report")) {
            const { rows, errors, meta } = parseTN360TripReport(raw);
            setKmRows(rows);
            setKmErrors(errors);
            setKmMeta(meta);
          } else {
            setKmRows([]);
            setKmErrors(["Unrecognised XLSX format. Upload a TN360 Distance Trip Report, or use a CSV file."]);
            setKmMeta(null);
          }
        } catch (err) {
          setKmRows([]);
          setKmErrors([`Could not read file: ${err instanceof Error ? err.message : String(err)}`]);
          setKmMeta(null);
        }
        setKmImportState("preview");
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV path
      const reader = new FileReader();
      reader.onload = (ev) => {
        const { rows, errors } = parseKmCSV(ev.target?.result as string);
        setKmRows(rows);
        setKmErrors(errors);
        setKmMeta({ source: "csv" });
        setKmImportState("preview");
      };
      reader.readAsText(file);
    }
  };

  const handleKmImport = async () => {
    if (!orgId || !kmRows.length) return;
    setKmImportState("importing");
    setKmProgress(10);
    try {
      const response = await fetch(`/api/organisations/${orgId}/fleet/import-km`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows: kmRows }),
      });
      setKmProgress(90);
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message || `HTTP ${response.status}`);
      }
      const result = await response.json() as { imported: number; created: string[]; errors: string[] };
      setKmProgress(100);
      setKmResults(result);
      setKmImportState("done");
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Import failed", description: e instanceof Error ? e.message : "Unknown error" });
      setKmImportState("preview");
      setKmProgress(0);
    }
  };

  const resetKmImport = () => {
    setKmImportState("idle");
    setKmRows([]);
    setKmErrors([]);
    setKmProgress(0);
    setKmMeta(null);
    setKmResults({ imported: 0, created: [], errors: [] });
    if (kmFileInputRef.current) kmFileInputRef.current.value = "";
  };

  const downloadKmTemplate = () => {
    const blob = new Blob([KM_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "km-import-template.csv"; a.click(); URL.revokeObjectURL(url);
  };

  // ─── Form ────────────────────────────────────────────────────────────────────

  const form = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { name: "", fuelType: "diesel", gpsProvider: "none" },
  });

  const onSubmit = async (data: z.infer<typeof vehicleSchema>) => {
    try {
      const fuelsaverFactor = plateLookup?.found ? plateLookup.emissionFactorKgPerKm : undefined;
      await createVehicle.mutateAsync({
        orgId: orgId!,
        data: {
          ...data,
          fuelType: data.fuelType as CreateVehicleRequestFuelType,
          gpsProvider: data.gpsProvider as CreateVehicleRequestGpsProvider,
          ...(fuelsaverFactor !== undefined ? { emissionFactorKgPerKm: fuelsaverFactor } : {}),
        },
      });
      toast({ title: "Vehicle added", description: fuelsaverFactor ? `WLTP emission factor applied: ${fuelsaverFactor.toFixed(3)} kg CO₂e/km` : undefined });
      setIsDialogOpen(false);
      setPlateLookup(null);
      form.reset();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not add vehicle" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this vehicle?")) return;
    try {
      await deleteVehicle.mutateAsync({ orgId: orgId!, vehicleId: id });
      toast({ title: "Vehicle removed" });
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not remove vehicle" });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const matchedKmRows = kmRows.filter(r => knownVehicles.has(r.vehicle.toLowerCase().trim()));
  const unmatchedKmRows = kmRows.filter(r => !knownVehicles.has(r.vehicle.toLowerCase().trim()));
  const newUniquePlates = [...new Set(unmatchedKmRows.map(r => r.vehicle))];
  const zHistoryCount = importRows.filter(r => r.skip).length;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Fleet Management</h1>
          <p className="text-muted-foreground mt-1">Manage vehicles and GPS integrations.</p>
        </div>

        <div className="flex flex-wrap gap-2">

          {/* ── Import KMs ── */}
          <Dialog open={isKmImportOpen} onOpenChange={(open) => { setIsKmImportOpen(open); if (!open) resetKmImport(); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2"><Gauge className="w-4 h-4" /> Import KMs</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-[680px] max-h-[90vh] flex flex-col overflow-hidden">
              <DialogHeader><DialogTitle>Import KM / Distance Data</DialogTitle></DialogHeader>

              {kmImportState === "idle" && (
                <div className="space-y-4 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Upload a TN360 Distance Trip Report (.xlsx) or a standard CSV file. Trip rows are automatically aggregated into daily vehicle totals before import.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-1">
                      <p className="text-xs font-semibold text-primary uppercase">TN360 Distance Report (.xlsx)</p>
                      <p className="text-xs text-muted-foreground">From TN360 → Reports → Distance Trip Report. Trips are aggregated to daily totals automatically.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Standard CSV</p>
                      <p className="text-xs text-muted-foreground">Columns: vehicle, date, distance_km, fuel_litres (optional).</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 gap-2" onClick={downloadKmTemplate}><Download className="w-4 h-4" /> CSV Template</Button>
                    <Button className="flex-1 gap-2" onClick={() => kmFileInputRef.current?.click()}><Upload className="w-4 h-4" /> Choose File</Button>
                  </div>
                  <input ref={kmFileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={handleKmFileSelect} />
                </div>
              )}

              {kmImportState === "preview" && (
                <div className="space-y-4 pt-2 overflow-y-auto flex-1 pr-1">
                  {/* TN360 detected banner */}
                  {kmMeta?.source === "tn360-trip" && kmRows.length > 0 && (
                    <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="text-sm space-y-0.5">
                        <p className="font-semibold text-foreground">TN360 Distance Trip Report detected</p>
                        <p className="text-muted-foreground text-xs">
                          Trips aggregated to <span className="text-foreground font-medium">{kmMeta.records?.toLocaleString()} daily totals</span> across <span className="text-foreground font-medium">{kmMeta.vehicles} vehicles</span>.
                          {kmMeta.period && <> · Period: {kmMeta.period}</>}
                        </p>
                      </div>
                    </div>
                  )}

                  {kmErrors.length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                      {kmErrors.map((e, i) => <p key={i} className="text-xs text-amber-600">{e}</p>)}
                    </div>
                  )}
                  {kmRows.length > 0 && (
                    <>
                      <div className="flex gap-3 text-sm">
                        <span className="flex items-center gap-1.5 text-emerald-500"><CheckCircle2 className="w-4 h-4" /> {matchedKmRows.length} matched</span>
                        {newUniquePlates.length > 0 && (
                          <span className="flex items-center gap-1.5 text-blue-500"><CheckCircle2 className="w-4 h-4" /> {newUniquePlates.length} new vehicle{newUniquePlates.length !== 1 ? "s" : ""} (will be auto-created)</span>
                        )}
                      </div>
                      {newUniquePlates.length > 0 && (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                          <p className="text-xs text-blue-600 font-semibold mb-1">New vehicles — will be added automatically:</p>
                          <p className="text-xs text-muted-foreground font-mono">{newUniquePlates.join(", ")}</p>
                          <p className="text-xs text-muted-foreground mt-1">These will be created as diesel vehicles. You can edit the details afterwards.</p>
                        </div>
                      )}
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-border text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-secondary/40 sticky top-0">
                            <tr>
                              {["Vehicle","Date","Distance","Fuel (L)","Match"].map(h => <th key={h} className="px-3 py-2 font-semibold text-muted-foreground uppercase">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {kmRows.map((row, i) => {
                              const matched = knownVehicles.has(row.vehicle.toLowerCase().trim());
                              return (
                                <tr key={i} className="hover:bg-secondary/20">
                                  <td className="px-3 py-2 font-medium">{row.vehicle}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{row.date}</td>
                                  <td className="px-3 py-2">{row.distanceKm} km</td>
                                  <td className="px-3 py-2 text-muted-foreground">{row.fuelLitres || "—"}</td>
                                  <td className="px-3 py-2">{matched ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <span className="text-xs text-blue-500 font-medium">New</span>}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" className="flex-1" onClick={resetKmImport}>Choose Different File</Button>
                        <Button className="flex-1 gap-2" onClick={handleKmImport}><Upload className="w-4 h-4" /> Import {kmRows.length} record{kmRows.length !== 1 ? "s" : ""}</Button>
                      </div>
                    </>
                  )}
                  {kmRows.length === 0 && kmErrors.length > 0 && (
                    <Button variant="outline" className="w-full" onClick={resetKmImport}>Try Again</Button>
                  )}
                </div>
              )}

              {kmImportState === "importing" && (
                <div className="space-y-4 pt-4 pb-2">
                  <p className="text-sm text-muted-foreground">Importing records and calculating emissions…</p>
                  <Progress value={kmProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">{kmProgress}%</p>
                </div>
              )}

              {kmImportState === "done" && (
                <div className="space-y-4 pt-4 pb-2">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">Import complete</p>
                      <p className="text-sm text-muted-foreground">
                        {kmResults.imported} record{kmResults.imported !== 1 ? "s" : ""} imported
                        {kmResults.created.length > 0 && <>, <span className="text-blue-500">{kmResults.created.length} new vehicle{kmResults.created.length !== 1 ? "s" : ""} added</span></>}
                        {kmResults.errors.length > 0 && <>, <span className="text-destructive">{kmResults.errors.length} errors</span></>}.
                      </p>
                    </div>
                  </div>
                  {kmResults.errors.length > 0 && (
                    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 max-h-32 overflow-y-auto">
                      {kmResults.errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
                    </div>
                  )}
                  <Button className="w-full" onClick={() => { setIsKmImportOpen(false); resetKmImport(); }}>Done</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* ── Import Vehicles (CSV / XLSX / TN360) ── */}
          <Dialog open={isImportOpen} onOpenChange={(open) => { setIsImportOpen(open); if (!open) resetImport(); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2"><FileSpreadsheet className="w-4 h-4" /> Import Vehicles</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-[680px]">
              <DialogHeader><DialogTitle>Import Vehicles</DialogTitle></DialogHeader>

              {importState === "idle" && (
                <div className="space-y-4 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Upload your TN360 <strong>Vehicle Summary Report</strong> (.xlsx) or a standard CSV file.
                    TN360 column names are mapped automatically and fuel type is detected from the vehicle model.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-1">
                      <p className="text-xs font-semibold text-primary uppercase">TN360 Export (.xlsx)</p>
                      <p className="text-xs text-muted-foreground">From TN360 → Reports → Vehicle Summary Report. Columns mapped automatically.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Standard CSV</p>
                      <p className="text-xs text-muted-foreground">Columns: name, registration, make, model, fuelType, gpsProvider.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 gap-2" onClick={downloadCsvTemplate}><Download className="w-4 h-4" /> CSV Template</Button>
                    <Button className="flex-1 gap-2" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4" /> Choose File</Button>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={handleFileSelect} />
                </div>
              )}

              {importState === "preview" && (
                <div className="space-y-4 pt-2">
                  {importSource === "tn360" && (
                    <div className="flex items-center gap-2 text-sm text-emerald-500">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>TN360 Vehicle Summary Report detected — columns mapped automatically.</span>
                    </div>
                  )}
                  {importErrors.length > 0 && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                      {importErrors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
                    </div>
                  )}
                  {importRows.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold text-foreground">{activeImportRows.length}</span> vehicle{activeImportRows.length !== 1 ? "s" : ""} ready to import
                          {zHistoryCount > 0 && <span className="text-muted-foreground"> ({zHistoryCount} Z-History retired vehicles excluded)</span>}
                        </p>
                        {zHistoryCount > 0 && (
                          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={includeZHistory}
                              onChange={e => setIncludeZHistory(e.target.checked)}
                              className="rounded"
                            />
                            Include Z-History
                          </label>
                        )}
                      </div>

                      <div className="max-h-56 overflow-y-auto rounded-lg border border-border text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-secondary/40 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 font-semibold text-muted-foreground uppercase">Rego / Name</th>
                              <th className="px-3 py-2 font-semibold text-muted-foreground uppercase">Make / Model</th>
                              <th className="px-3 py-2 font-semibold text-muted-foreground uppercase">Fuel</th>
                              {importSource === "tn360" && <th className="px-3 py-2 font-semibold text-muted-foreground uppercase">Fleet</th>}
                              <th className="px-3 py-2 font-semibold text-muted-foreground uppercase">GPS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {importRows
                              .filter(r => !r.skip || includeZHistory)
                              .map((row, i) => (
                                <tr key={i} className="hover:bg-secondary/20">
                                  <td className="px-3 py-2 font-medium font-mono">{row.name}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{[row.make, row.model].filter(Boolean).join(" ") || "—"}</td>
                                  <td className="px-3 py-2"><span className="px-2 py-0.5 bg-secondary rounded-full capitalize">{row.fuelType}</span></td>
                                  {importSource === "tn360" && <td className="px-3 py-2 text-muted-foreground text-xs">{row.fleet || "—"}</td>}
                                  <td className="px-3 py-2">{row.hasGps ? <span className="text-emerald-500 text-xs">GPS</span> : <span className="text-muted-foreground text-xs">None</span>}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex gap-3">
                        <Button variant="outline" className="flex-1" onClick={resetImport}>Choose Different File</Button>
                        <Button className="flex-1 gap-2" onClick={handleImport} disabled={activeImportRows.length === 0}>
                          <Upload className="w-4 h-4" /> Import {activeImportRows.length} Vehicle{activeImportRows.length !== 1 ? "s" : ""}
                        </Button>
                      </div>
                    </>
                  )}
                  {importRows.length === 0 && importErrors.length > 0 && (
                    <Button variant="outline" className="w-full" onClick={resetImport}>Try Again</Button>
                  )}
                </div>
              )}

              {importState === "importing" && (
                <div className="space-y-4 pt-4 pb-2">
                  <p className="text-sm text-muted-foreground">Registering vehicles… ({Math.round(importProgress * activeImportRows.length / 100)}/{activeImportRows.length})</p>
                  <Progress value={importProgress} className="h-2" />
                </div>
              )}

              {importState === "done" && (
                <div className="space-y-4 pt-4 pb-2">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">Import complete</p>
                      <p className="text-sm text-muted-foreground">
                        {importResults.ok} vehicle{importResults.ok !== 1 ? "s" : ""} registered
                        {importResults.failed > 0 && <>, <span className="text-destructive">{importResults.failed} failed (may already exist)</span></>}.
                      </p>
                    </div>
                  </div>
                  <Button className="w-full" onClick={() => { setIsImportOpen(false); resetImport(); }}>Done</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* ── Add Vehicle ── */}
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setPlateLookup(null); setPlateLookupLoading(false); } }}>
            <DialogTrigger asChild>
              <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" /> Add Vehicle
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-[520px]">
              <DialogHeader><DialogTitle>Register New Vehicle</DialogTitle></DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">

                  {/* Registration + Fuelsaver lookup */}
                  <FormField control={form.control} name="registration" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration Plate</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. ABC123"
                            className="uppercase"
                            onChange={e => { field.onChange(e.target.value.toUpperCase()); setPlateLookup(null); }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5 shrink-0"
                          disabled={plateLookupLoading || !field.value || field.value.length < 2}
                          onClick={() => lookupPlate(field.value ?? "")}
                        >
                          {plateLookupLoading
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Search className="w-4 h-4" />}
                          Look up
                        </Button>
                      </div>
                      <FormMessage />

                      {/* Fuelsaver result badge */}
                      {plateLookup && (
                        <div className={`mt-2 rounded-lg border px-4 py-3 text-sm ${
                          plateLookup.found
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : plateLookup.configured === false
                              ? "border-amber-500/30 bg-amber-500/10"
                              : "border-destructive/30 bg-destructive/10"
                        }`}>
                          {plateLookup.found ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                  <CheckCircle2 className="w-4 h-4" /> WLTP data found
                                </span>
                                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                  {Array.from({ length: 6 }).map((_, i) => (
                                    <Star key={i} className={`w-3 h-3 ${i < (plateLookup.co2Stars ?? 0) ? "fill-emerald-400 text-emerald-400" : "text-muted-foreground/30"}`} />
                                  ))}
                                  <span className="ml-1">{plateLookup.co2Stars ?? "?"}/6</span>
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground mt-1">
                                <span>Tailpipe CO₂: <strong className="text-foreground">{plateLookup.co2GPerKm} g/km</strong></span>
                                <span>CO₂e factor: <strong className="text-foreground">{plateLookup.emissionFactorKgPerKm.toFixed(3)} kg/km</strong></span>
                                {plateLookup.fuelL100km && <span>Economy: <strong className="text-foreground">{plateLookup.fuelL100km} L/100km</strong></span>}
                                {plateLookup.yearlyTonnes && <span>Yearly: <strong className="text-foreground">{plateLookup.yearlyTonnes} t CO₂</strong></span>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 italic">
                                Fuel type, make, model and emission factor auto-filled. Includes 15% NZ MfE upstream uplift.
                              </p>
                            </div>
                          ) : plateLookup.configured === false ? (
                            <p className="text-amber-400 text-xs">Fuelsaver API not configured yet — add <code>FUELSAVER_LOGIN</code> and <code>FUELSAVER_PASSWORD</code> in Secrets.</p>
                          ) : (
                            <p className="text-destructive text-xs">
                              No WLTP data found for this plate (code: {(plateLookup as {errorCode?: string}).errorCode ?? "unknown"}). Fill in details manually.
                            </p>
                          )}
                        </div>
                      )}
                    </FormItem>
                  )} />

                  {/* Internal name */}
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>Internal Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Truck 01 or DLK588" /></FormControl><FormMessage /></FormItem>
                  )} />

                  {/* Make / Model */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="make" render={({ field }) => (
                      <FormItem><FormLabel>Make</FormLabel><FormControl><Input {...field} placeholder="e.g. Toyota" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="model" render={({ field }) => (
                      <FormItem><FormLabel>Model</FormLabel><FormControl><Input {...field} placeholder="e.g. Hilux SR5" /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  {/* Fuel type */}
                  <FormField control={form.control} name="fuelType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fuel Type</FormLabel>
                      <FormControl>
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" {...field}>
                          <option value="diesel">Diesel</option>
                          <option value="petrol">Petrol</option>
                          <option value="electric">Electric</option>
                          <option value="hybrid">Hybrid</option>
                          <option value="lpg">LPG</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* GPS */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="gpsProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel>GPS Provider</FormLabel>
                        <FormControl>
                          <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" {...field}>
                            <option value="none">None</option>
                            <option value="navman">Navman</option>
                            <option value="blackhawk">Blackhawk</option>
                            <option value="generic">TN360 / Other</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="gpsDeviceId" render={({ field }) => (
                      <FormItem><FormLabel>Device ID (optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  <Button type="submit" className="w-full mt-4" disabled={createVehicle.isPending}>
                    {createVehicle.isPending ? "Saving..." : "Save Vehicle"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Top Emitters Leaderboard ────────────────────────────────────────── */}
      {(vehicleStats && vehicleStats.length > 0) && (() => {
        const top = vehicleStats.slice(0, 10);
        const maxCo2 = Math.max(...top.map(v => v.totalCo2eKg), 1);
        const getFactorLabel = (v: VehicleStat) => {
          const factor = v.effectiveEmissionFactor ?? v.co2ePerKm;
          if (factor === 0) return { label: "Equipment", color: "text-muted-foreground" };
          if (factor >= 0.5)  return { label: "Heavy truck", color: "text-red-400" };
          if (factor >= 0.3)  return { label: "Med. truck", color: "text-orange-400" };
          return { label: "Light", color: "text-emerald-400" };
        };
        return (
          <Card className="border-border/50 overflow-hidden">
            <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-400" />
                  Top Emitters — Fleet CO₂ Leaderboard
                </h3>
                <p className="text-muted-foreground text-sm mt-0.5">
                  Ranked by total CO₂e. Emission factors applied per vehicle class (NZ MfE guidance).
                </p>
              </div>
              {loadingStats && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
                  <tr>
                    <th className="px-4 py-3 w-8">#</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3 hidden md:table-cell">Make / Model</th>
                    <th className="px-4 py-3">Class</th>
                    <th className="px-4 py-3 text-right">kg CO₂e/km</th>
                    <th className="px-4 py-3 text-right">Total km</th>
                    <th className="px-4 py-3 text-right">Total CO₂e</th>
                    <th className="px-4 py-3 w-32">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {top.map((v, i) => {
                    const pct = Math.round((v.totalCo2eKg / maxCo2) * 100);
                    const { label, color } = getFactorLabel(v);
                    const rankColor = i === 0 ? "text-red-400 font-bold" : i === 1 ? "text-orange-400 font-semibold" : i === 2 ? "text-yellow-400" : "text-muted-foreground";
                    return (
                      <tr key={v.vehicleId} className="hover:bg-secondary/20 transition-colors">
                        <td className={`px-4 py-3 font-mono text-xs ${rankColor}`}>{i + 1}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-foreground font-mono">{v.name}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell max-w-[200px] truncate">
                          {v.make} {v.model ? v.model.split(" ").slice(0, 3).join(" ") : ""}
                        </td>
                        <td className={`px-4 py-3 text-xs font-medium ${color}`}>{label}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {(v.effectiveEmissionFactor ?? v.co2ePerKm) > 0
                            ? (v.effectiveEmissionFactor ?? v.co2ePerKm).toFixed(3)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground font-mono text-xs">
                          {v.totalKm.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">
                          {v.totalCo2eKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${i === 0 ? "bg-red-500" : i <= 2 ? "bg-orange-400" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-border/50 bg-secondary/10 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Light commercial: 0.214 kg/km (Hilux, Hiace)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Medium truck: 0.340 kg/km (Hino Dutro, Isuzu NPR)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Heavy truck: 0.52–0.90 kg/km</span>
              <span className="ml-auto">Source: NZ MfE vehicle emission factors</span>
            </div>
          </Card>
        );
      })()}

      {/* Webhook Info */}
      <Card className="p-6 bg-secondary/10 border-primary/20">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl mt-1"><Server className="w-6 h-6 text-primary" /></div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">GPS Webhook Integration</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Configure your fleet provider to push live data to these endpoints. For TN360, use the Generic endpoint with your org API key.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Navman</p>
                <code className="text-xs text-primary font-mono">{window.location.origin}/api/webhooks/fleet/navman</code>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">TN360 / Generic</p>
                <code className="text-xs text-primary font-mono">{window.location.origin}/api/webhooks/fleet/generic</code>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Vehicle Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Vehicle</th>
                <th className="px-6 py-4">Fuel</th>
                <th className="px-6 py-4">GPS</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {vehicles?.items.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-secondary rounded-lg"><Car className="w-4 h-4 text-muted-foreground" /></div>
                      <div>
                        <div className="font-medium font-mono text-foreground">{vehicle.name}</div>
                        <div className="text-xs text-muted-foreground">{vehicle.registration || "No Rego"}{vehicle.make ? ` • ${vehicle.make}` : ""}{vehicle.model ? ` ${vehicle.model}` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 capitalize"><span className="px-2.5 py-1 bg-secondary rounded-full text-xs">{vehicle.fuelType}</span></td>
                  <td className="px-6 py-4">
                    {vehicle.gpsProvider !== "none"
                      ? <div className="flex items-center text-xs text-emerald-400 gap-1"><Navigation className="w-3 h-3" /> {vehicle.gpsProvider}</div>
                      : <span className="text-xs text-muted-foreground">None</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs ${vehicle.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                      {vehicle.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(vehicle.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {(!vehicles?.items || vehicles.items.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No vehicles registered yet. Import from TN360 or add one manually.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
