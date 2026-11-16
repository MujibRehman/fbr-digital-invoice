import { randomBytes, randomUUID, createHash } from "node:crypto";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { transaction } from "../config/database.js";
import { audit } from "../audit/audit.service.js";
import { fail } from "../middleware/validation.js";
import { revokeSessions } from "./auth.middleware.js";
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export function makeMailer(config) {
  const transport = config.smtp
    ? nodemailer.createTransport(config.smtp)
    : null;
  return {
    available: !!transport,
    async send(to, url, purpose) {
      if (!transport)
        fail(
          503,
          "Email is not configured. Ask an administrator for a temporary password.",
        );
      await transport.sendMail({
        from: config.mailFrom,
        to,
        subject:
          purpose === "ACCOUNT_SETUP"
            ? "Set up your fbr-digital-invoice account"
            : "Reset your fbr-digital-invoice password",
        text: `Open this single-use link to set your fbr-digital-invoice password:\n\n${url}\n\nIf you did not expect this message, contact your administrator.`,
      });
    },
  };
}
export async function sendToken(pool, config, mailer, userId, purpose, req) {
  if (!mailer.available)
    fail(503, "Email is not configured. Use a temporary password instead.");
  const raw = randomBytes(32).toString("hex");
  const id = randomUUID();
  const user = await transaction(pool, async (db) => {
    const {
      rows: [u],
    } = await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!u || u.status !== "ACTIVE") fail(400, "An active account is required");
    await db.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [userId],
    );
    await db.query(
      "INSERT INTO password_reset_tokens(id,user_id,token_hash,purpose,expires_at) VALUES($1,$2,$3,$4,now()+$5::interval)",
      [
        id,
        userId,
        hashToken(raw),
        purpose,
        purpose === "ACCOUNT_SETUP" ? "24 hours" : "45 minutes",
      ],
    );
    await audit(db, req, "PASSWORD_RESET_REQUESTED", "user", userId, {
      purpose,
    });
    return u;
  });
  try {
    // Fragment keeps the raw token out of HTTP access logs and referrer URLs.
    await mailer.send(
      user.email,
      `${config.appUrl}/setup-password#token=${raw}`,
      purpose,
    );
    await audit(
      pool,
      req,
      purpose === "ACCOUNT_SETUP"
        ? "ACCOUNT_SETUP_SENT"
        : "PASSWORD_RESET_SENT",
      "user",
      userId,
    );
  } catch {
    await pool.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE id=$1",
      [id],
    );
    await audit(pool, req, "PASSWORD_EMAIL_FAILED", "user", userId);
    fail(
      503,
      "The password email could not be delivered. Try again or use a temporary password.",
    );
  }
}
export async function resetPassword(pool, raw, password, req) {
  const tokenHash = hashToken(raw);
  const hash = await bcrypt.hash(password, 12);
  return transaction(pool, async (db) => {
    // Lock the user first on every lifecycle path, then the token, to avoid lock inversion.
    const {
      rows: [candidate],
    } = await db.query(
      "SELECT user_id FROM password_reset_tokens WHERE token_hash=$1",
      [tokenHash],
    );
    if (!candidate) fail(400, "This password link is invalid or expired");
    const {
      rows: [user],
    } = await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
      candidate.user_id,
    ]);
    const {
      rows: [token],
    } = await db.query(
      "SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
      [tokenHash],
    );
    if (!token || user.status !== "ACTIVE")
      fail(400, "This password link is invalid or expired");
    await db.query(
      "UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2",
      [hash, user.id],
    );
    await db.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [user.id],
    );
    await revokeSessions(db, user.id);
    await audit(
      db,
      { ...req, user },
      token.purpose === "ACCOUNT_SETUP"
        ? "ACCOUNT_SETUP_COMPLETED"
        : "PASSWORD_RESET_SUCCESS",
      "user",
      user.id,
    );
    await audit(db, { ...req, user }, "SESSIONS_REVOKED", "user", user.id);
  });
}
