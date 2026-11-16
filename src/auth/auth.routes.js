import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { rateLimit } from "express-rate-limit";
import { parse, email, password, fail } from "../middleware/validation.js";
import {
  requireAuth,
  requireReady,
  csrfToken,
  revokeSessions,
} from "./auth.middleware.js";
import { hashToken, resetPassword, sendToken } from "./auth.service.js";
import { transaction } from "../config/database.js";
import { audit } from "../audit/audit.service.js";
const generic =
  "If an active account exists for this email, a password reset link has been requested.";
const destroy = (req) =>
  new Promise((resolve, reject) =>
    req.session.destroy((e) => (e ? reject(e) : resolve())),
  );
export function authRoutes(pool, config, mailer) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again in 15 minutes." },
  });
  const dummyHash = bcrypt.hashSync("NotARealPassword!7402", 12);
  r.get("/csrf", (req, res) =>
    res.json({
      csrfToken: csrfToken(req),
      environment: config.appEnv,
      mock: config.mock,
    }),
  );
  r.post("/login", limiter, async (req, res) => {
    const input = parse(
      z.object({ email, password: z.string().min(1).max(200) }),
      req.body,
    );
    const key = hashToken(input.email);
    const user = await transaction(pool, async (db) => {
      await db.query(
        "INSERT INTO login_attempts(email_hash) VALUES($1) ON CONFLICT DO NOTHING",
        [key],
      );
      let {
        rows: [attempt],
      } = await db.query(
        "SELECT * FROM login_attempts WHERE email_hash=$1 FOR UPDATE",
        [key],
      );
      if (
        Date.now() - new Date(attempt.window_start).getTime() >
        15 * 60 * 1000
      ) {
        await db.query(
          "UPDATE login_attempts SET failures=0,window_start=now() WHERE email_hash=$1",
          [key],
        );
        attempt.failures = 0;
      }
      if (attempt.failures >= 10) return null;
      const {
        rows: [u],
      } = await db.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [
        input.email,
      ]);
      const valid = await bcrypt.compare(
        input.password,
        u?.password_hash || dummyHash,
      );
      if (!valid || u?.status !== "ACTIVE") {
        await db.query(
          "UPDATE login_attempts SET failures=failures+1 WHERE email_hash=$1",
          [key],
        );
        await audit(db, req, "LOGIN_FAILED", null, null, { emailHash: key });
        return null;
      }
      await db.query("DELETE FROM login_attempts WHERE email_hash=$1", [key]);
      await db.query("UPDATE users SET last_login_at=now() WHERE id=$1", [
        u.id,
      ]);
      await audit(db, { ...req, user: u }, "LOGIN_SUCCESS", "user", u.id);
      return u;
    });
    if (!user) fail(401, "Invalid email or password");
    await new Promise((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    req.session.userId = user.id;
    req.session.version = user.session_version;
    res.json({
      csrfToken: csrfToken(req),
      mustChangePassword: user.must_change_password,
    });
  });
  r.post("/forgot-password", limiter, async (req, res) => {
    const input = parse(z.object({ email }), req.body);
    const {
      rows: [user],
    } = await pool.query(
      "SELECT id FROM users WHERE email=$1 AND status='ACTIVE'",
      [input.email],
    );
    // Defer delivery for the same public response timing regardless of account existence.
    if (user && mailer.available)
      setImmediate(() =>
        sendToken(pool, config, mailer, user.id, "PASSWORD_RESET", req).catch(
          () => {},
        ),
      );
    res.json({ message: generic });
  });
  r.post("/reset-password", limiter, async (req, res) => {
    const input = parse(
      z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }),
      req.body,
    );
    await resetPassword(pool, input.token, input.password, req);
    await destroy(req);
    res
      .clearCookie(config.cookieName, { path: "/" })
      .json({ message: "Password set. Sign in with your new password." });
  });
  r.get("/me", requireAuth, (req, res) => {
    const { session_version, ...user } = req.user;
    res.json({
      user,
      environment: config.appEnv,
      mock: config.mock,
      emailEnabled: mailer.available,
      csrfToken: csrfToken(req),
    });
  });
  r.post("/logout", requireAuth, async (req, res) => {
    await audit(pool, req, "LOGOUT", "user", req.user.id);
    await destroy(req);
    res.clearCookie(config.cookieName, { path: "/" }).json({ ok: true });
  });
  r.post("/logout-all", requireAuth, async (req, res) => {
    await transaction(pool, async (db) => {
      await revokeSessions(db, req.user.id);
      await audit(db, req, "SESSIONS_REVOKED", "user", req.user.id);
    });
    await destroy(req);
    res.clearCookie(config.cookieName, { path: "/" }).json({ ok: true });
  });
  r.post("/change-password", requireAuth, async (req, res) => {
    const input = parse(
      z.object({ currentPassword: z.string().min(1).max(200), password }),
      req.body,
    );
    if (input.currentPassword === input.password)
      fail(400, "Choose a different password");
    await transaction(pool, async (db) => {
      const {
        rows: [u],
      } = await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (!(await bcrypt.compare(input.currentPassword, u.password_hash)))
        fail(400, "Current password is incorrect");
      await db.query(
        "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2",
        [await bcrypt.hash(input.password, 12), u.id],
      );
      await db.query(
        "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [u.id],
      );
      await revokeSessions(db, u.id);
      await audit(db, req, "PASSWORD_CHANGED", "user", u.id);
      await audit(db, req, "SESSIONS_REVOKED", "user", u.id);
    });
    await destroy(req);
    res
      .clearCookie(config.cookieName, { path: "/" })
      .json({ message: "Password changed. Please sign in again." });
  });
  r.post("/change-email", requireAuth, requireReady, async (req, res) => {
    const input = parse(
      z.object({
        newEmail: email,
        currentPassword: z.string().min(1).max(200),
      }),
      req.body,
    );
    await transaction(pool, async (db) => {
      const {
        rows: [user],
      } = await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (!(await bcrypt.compare(input.currentPassword, user.password_hash)))
        fail(400, "Current password is incorrect");
      if (input.newEmail === user.email)
        fail(400, "Enter a different email address");
      if (
        (
          await db.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [
            input.newEmail,
            user.id,
          ])
        ).rowCount
      )
        fail(409, "That email address is already in use");
      await db.query("UPDATE users SET email=$1,updated_at=now() WHERE id=$2", [
        input.newEmail,
        user.id,
      ]);
      await db.query(
        "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [user.id],
      );
      await audit(db, req, "USER_EMAIL_CHANGED", "user", user.id, {
        old_email: user.email,
        new_email: input.newEmail,
      });
      await revokeSessions(db, user.id);
      await audit(db, req, "SESSIONS_REVOKED", "user", user.id);
    });
    await destroy(req);
    res
      .clearCookie(config.cookieName, { path: "/" })
      .json({ message: "Email changed. Sign in with your new email address." });
  });
  return r;
}
