import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import {
  authMiddleware,
  csrf,
  requireAuth,
  requireReady,
  requireRole,
} from "./auth/auth.middleware.js";
import { authRoutes } from "./auth/auth.routes.js";
import { makeMailer } from "./auth/auth.service.js";
import { userRoutes } from "./users/users.routes.js";
import { invoiceRoutes } from "./invoices/invoices.routes.js";
import { fbrClient } from "./fbr/fbr.client.js";
import { page, fail } from "./middleware/validation.js";
export function createApp({
  pool,
  config,
  client = fbrClient(config),
  mailer = makeMailer(config),
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      strictTransportSecurity: config.secure ? undefined : false,
      contentSecurityPolicy: {
        directives: { "upgrade-insecure-requests": config.secure ? [] : null },
      },
    }),
  );
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  });
  app.use((req, res, next) => {
    if (config.secure && !req.secure)
      return res.status(400).json({ error: "HTTPS is required" });
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  const PgStore = connectPgSimple(session);
  const sessionStore = new PgStore({
    pool,
    tableName: "sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 60,
    errorLog: () => console.error("Session store operation failed"),
  });
  app.locals.sessionStore = sessionStore;
  app.use(
    session({
      store: sessionStore,
      name: config.cookieName,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        secure: config.secure,
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );
  app.use(authMiddleware(pool));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Try again shortly." },
    }),
  );
  // Authenticate private routes before CSRF so anonymous calls consistently return 401.
  app.use("/api", (req, res, next) => {
    const publicPaths = [
      "/auth/csrf",
      "/auth/login",
      "/auth/forgot-password",
      "/auth/reset-password",
    ];
    if (publicPaths.includes(req.path)) return next();
    requireAuth(req, res, next);
  });
  app.use("/api", csrf(config));
  app.use("/api/auth", authRoutes(pool, config, mailer));
  app.use("/api", requireAuth, requireReady);
  app.use("/api/users", userRoutes(pool, config, mailer));
  app.use("/api/invoices", invoiceRoutes(pool, config, client));
  app.get("/api/audit", requireRole("ADMIN"), async (req, res) => {
    const { limit, offset } = page(req.query);
    res.json(
      (
        await pool.query(
          "SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2",
          [limit, offset],
        )
      ).rows,
    );
  });
  app.get("/api/fbr/reference/:kind", async (req, res) => {
    if (!["provinces", "uom", "saleTypes"].includes(req.params.kind))
      fail(404, "Reference not found");
    try {
      res.json(await client.reference(req.params.kind));
    } catch {
      fail(502, "FBR reference data is unavailable");
    }
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Route not found" }),
  );
  const publicDir = fileURLToPath(new URL("../dist/client/", import.meta.url));
  app.use(express.static(publicDir, { index: false, dotfiles: "deny" }));
  app.get(
    [
      "/",
      "/login",
      "/forgot-password",
      "/setup-password",
      "/overview",
      "/create-invoice",
      "/invoices",
      "/invoices/new",
      "/invoices/:id",
      "/invoices/:id/edit",
      "/users",
      "/audit",
      "/account",
    ],
    (req, res) => res.sendFile(`${publicDir}/index.html`),
  );
  app.use((req, res) => res.status(404).send("Not found"));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === "23505")
      return res.status(409).json({ error: "This record already exists" });
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500)
      console.error("Request failed", { code: error.code || "INTERNAL_ERROR" });
    res.status(status).json({
      error:
        status === 500
          ? "Unable to complete the request. Contact your administrator."
          : error.message,
    });
  });
  return app;
}
