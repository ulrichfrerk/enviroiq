import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { logAudit } from "./lib/audit.js";

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  logger.error("SESSION_SECRET env var is required in production");
  process.exit(1);
}

const app: Express = express();

// Trust proxy (needed for X-Forwarded-For in Replit/reverse proxy environments)
app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// Logging
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — allow the specific Replit domain and localhost for dev
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [/\.replit\.app$/, /\.replit\.dev$/, /localhost/];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

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

// Session — PostgreSQL-backed store (durable, multi-instance safe)
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
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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
      action: `api.${req.method.toLowerCase()}.${req.path.replace(/\/[0-9a-f-]{8,}/g, "/:id").replace(/\//g, ".")}`,
      outcome,
    });
  });
  next();
});

app.use("/api", router);

export default app;
