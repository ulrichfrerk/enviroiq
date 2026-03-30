import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    role: "super_admin" | "org_admin" | "org_viewer";
    organisationId: string | null;
    currentChallenge?: string;
  }
}
