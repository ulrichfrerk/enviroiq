export type EmissionReading = {
  id: string;
  organisationId: string;
  sourceType: "fleet" | "energy";
  sourceId: string;
  scope: "1" | "2" | "3";
  co2eKg: number;
  recordedAt: Date | string;
  createdAt: Date | string;
};

export type DataSource = {
  id: string;
  organisationId: string;
  name: string;
  sourceType: "fleet" | "energy";
  provider: string | null;
  isActive: boolean;
  createdAt: Date | string;
};
