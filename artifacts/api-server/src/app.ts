import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// Trust proxy (needed for X-Forwarded-For in Replit/reverse proxy environments)
app.set("trust proxy", 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

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

// CORS
app.use(cors({
  origin: true,
  credentials: true,
}));

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

// Session
const sessionSecret = process.env.SESSION_SECRET || "enviroiq-dev-secret-change-in-production-12345";
app.use(
  session({
    secret: sessionSecret,
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

app.use("/api", router);

export default app;
