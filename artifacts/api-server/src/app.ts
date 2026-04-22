import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { logAudit } from "./lib/audit.js";
import { correlationMiddleware } from "./lib/api-context.js";

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  logger.error("SESSION_SECRET env var is required in production");
  process.exit(1);
}

const app: Express = express();

// Trust proxy (needed for X-Forwarded-For in Replit/reverse proxy environments)
app.set("trust proxy", 1);

// Response compression (gzip / Brotli)
app.use(compression());

// Security headers — all applied to /api/* responses
app.use(
  helmet({
    // CSP is handled by the frontend server (server.mjs); API responses don't serve HTML
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Explicit overrides to ensure all scanners see these on API responses:
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
    noSniff: true,
    xssFilter: true,
    permittedCrossDomainPolicies: false,
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// Remove the Server header — suppress any value set by Node.js/Express before
// the CDN proxy adds its own. This prevents server fingerprinting via our layer.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader("Server");
  res.removeHeader("X-Powered-By");
  next();
});

// Permissions-Policy (not yet in helmet's built-in set)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  next();
});

// Logging
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        // SECURITY: Strip secrets out of URLs before logging. The public
        // supplier-audit and supplier-portal flows carry bearer tokens in the
        // path, which must never appear in any logger output.
        const stripped = req.url?.split("?")[0]
          ?.replace(/(\/public\/audits\/[^/]+)\/[^/?]+(\/[^/?]+)?/g, "$1/[REDACTED]$2")
          ?.replace(/(\/portal\/verify)\?.*$/i, "$1?[REDACTED]");
        return { id: req.id, method: req.method, url: stripped };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — explicit deny-by-default allowlist with credentials.
// ALLOWED_ORIGINS must be set in production; dev falls back to Replit domains + localhost.
function buildAllowedOrigins(): string[] {
  if (process.env.ALLOWED_ORIGINS) {
    const list = process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
    return list;
  }
  if (process.env.NODE_ENV === "production") {
    // In production without ALLOWED_ORIGINS, derive from Replit domain env
    const replitDomains = process.env.REPLIT_DOMAINS?.split(",").map((d) => `https://${d.trim()}`).filter(Boolean) || [];
    if (replitDomains.length > 0) return replitDomains;
    logger.warn("ALLOWED_ORIGINS not set in production — CORS will block all cross-origin requests");
    return [];
  }
  // Development: allow Replit preview domains and localhost
  const replitDev = process.env.REPLIT_DEV_DOMAIN ? [`https://${process.env.REPLIT_DEV_DOMAIN}`] : [];
  const replitDomains = process.env.REPLIT_DOMAINS?.split(",").map((d) => `https://${d.trim()}`).filter(Boolean) || [];
  return [...new Set([...replitDev, ...replitDomains, "http://localhost:3000", "http://localhost:5173", "http://localhost:22592"])];
}

const corsOrigins = buildAllowedOrigins();

// Public grid intensity endpoint — open CORS, no credentials needed.
app.use("/api/grid", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.removeHeader("Access-Control-Allow-Credentials");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
    return;
  }
  next();
});

// Public sanitised compliance endpoints — open CORS for the marketing site.
app.use("/api/compliance/public", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.removeHeader("Access-Control-Allow-Credentials");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
    return;
  }
  next();
});

// Public widget endpoints need open CORS for cross-origin embedding.
// This runs BEFORE the global CORS middleware and explicitly sets the final headers.
// The Access-Control-Allow-Credentials header must NOT be true alongside '*' origin.
app.use("/api/widget", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.removeHeader("Access-Control-Allow-Credentials");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
    return;
  }
  next();
});

// All other API routes use the explicit allowlist with credentials.
// Widget routes are excluded — they have their own open CORS policy above.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith("/api/widget/") ||
    req.path.startsWith("/api/grid/") ||
    req.path.startsWith("/api/compliance/public")
  ) {
    next();
    return;
  }
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  })(req, res, next);
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", limiter);
app.use("/api/auth", authLimiter);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
// Cookie parsing — required by the supplier-portal magic-link cookie session.
app.use(cookieParser());

// Detect HTTPS context: Replit always terminates TLS at the proxy layer, so any
// request served via REPLIT_DEV_DOMAIN or REPLIT_DOMAINS is HTTPS even in dev mode.
// We must set Secure=true in those environments so cookies are never sent over HTTP.
const isHttpsContext =
  process.env.NODE_ENV === "production" ||
  !!process.env.REPLIT_DOMAINS ||
  !!process.env.REPLIT_DEV_DOMAIN;

// Session — PostgreSQL-backed store (durable, multi-instance safe)
// createTableIfMissing is intentionally false: that option reads a 'table.sql' file
// from the package directory which doesn't exist in the bundled production build.
// Instead, ensureSessionTable() in index.ts creates it from inline SQL at startup.
const PgStore = ConnectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: false,
      pruneSessionInterval: 60 * 15, // prune expired sessions every 15 min
    }),
    secret: sessionSecret || "enviroiq-dev-only-secret-do-not-use-in-production",
    resave: false,
    saveUninitialized: false,
    name: "eiq.sid", // non-default name prevents fingerprinting
    cookie: {
      httpOnly: true,
      secure: isHttpsContext,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// Centralized audit middleware — logs all mutating API calls after response
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (!mutatingMethods.has(req.method)) { next(); return; }
  // Skip auth endpoints (they log their own outcomes) and webhook endpoints
  const skipPrefixes = ["/api/auth/", "/api/webhooks/", "/api/widget/"];
  if (skipPrefixes.some((p) => req.path.startsWith(p.slice("/api".length)))) { next(); return; }
  res.on("finish", () => {
    const outcome: "success" | "failure" = res.statusCode >= 400 ? "failure" : "success";
    void logAudit({
      req,
      action: `api.${req.method.toLowerCase()}.${req.path
        // Redact opaque public audit tokens (base64url, 32+ chars) before any UUID redaction
        .replace(/(\/public\/audits\/[^/]+)\/[^/?]+/g, "$1/:token")
        .replace(/\/[0-9a-f-]{8,}/g, "/:id")
        .replace(/\//g, ".")}`,
      outcome,
    });
  });
  next();
});

// FGC: per-request correlation ID — feeds response.meta.requestId + audit logs
app.use("/api", correlationMiddleware);

app.use("/api", router);

export default app;
