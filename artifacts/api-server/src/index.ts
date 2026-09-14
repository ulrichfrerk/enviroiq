import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, stopScheduler } from "./lib/scheduler";
import { startSupplierAuditScheduler } from "./lib/scheduler-supplier-audits";
import { startGapDetector, stopGapDetector } from "./lib/notification-gap-scanners";
import { ensureRuntimeSchema } from "./schema-bootstrap";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}


// Ensure all DB prerequisites exist, then start listening
ensureRuntimeSchema({ exitOnMismatch: true })
  .then(() => {    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startScheduler();
      startSupplierAuditScheduler();
      startGapDetector();
    });

    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, shutting down gracefully");
      stopScheduler();
      stopGapDetector();
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", () => {
      stopScheduler();
      stopGapDetector();
      server.close(() => process.exit(0));
    });
  })
  .catch((err) => {
    logger.error(
      { err },
      "Startup failed — one of the ensure*/verify-schema steps threw before the server could bind",
    );
    process.exit(1);
  });

