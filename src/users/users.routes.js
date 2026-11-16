import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import {
  text,
  email,
  roles,
  parse,
  uuid,
  fail,
} from "../middleware/validation.js";
import { requireRole, revokeSessions } from "../auth/auth.middleware.js";
import { sendToken } from "../auth/auth.service.js";
import { audit } from "../audit/audit.service.js";
import { transaction } from "../config/database.js";
const publicFields =
  "id,name,email,role,status,must_change_password,last_login_at,created_at";
const temporaryPassword = () => `Bt!9${randomBytes(18).toString("base64url")}`;
export function userRoutes(pool, config, mailer) {
  const r = Router();
  r.use(requireRole("ADMIN"));
  r.get("/", async (req, res) =>
    res.json(
      (
        await pool.query(
          `SELECT ${publicFields} FROM users ORDER BY created_at DESC`,
        )
      ).rows,
    ),
  );
  r.post("/", async (req, res) => {
    const input = parse(
      z.object({
        name: text(150),
        email,
        role: roles,
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
      }),
      req.body,
    );
    const id = randomUUID(),
      temp = temporaryPassword();
    await transaction(pool, async (db) => {
      await db.query(
        "INSERT INTO users(id,name,email,role,status,password_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          input.name,
          input.email,
          input.role,
          input.status,
          await bcrypt.hash(temp, 12),
        ],
      );
      await audit(db, req, "USER_CREATED", "user", id, {
        role: input.role,
        status: input.status,
      });
    });
    let warning;
    if (mailer.available && input.status === "ACTIVE") {
      try {
        await sendToken(pool, config, mailer, id, "ACCOUNT_SETUP", req);
      } catch {
        warning =
          "User created, but invitation delivery failed. Use Send password reset to retry.";
      }
    }
    res.status(201).json({
      id,
      ...(!mailer.available ? { temporaryPassword: temp } : {}),
      warning,
    });
  });
  async function change(req, patch) {
    const id = uuid(req.params.id);
    await transaction(pool, async (db) => {
      // Serialize admin changes to prevent concurrent removal of the last active administrator.
      await db.query("SELECT pg_advisory_xact_lock(8675311)");
      const {
        rows: [u],
      } = await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id]);
      if (!u) fail(404, "User not found");
      const role = patch.role ?? u.role,
        status = patch.status ?? u.status;
      if (
        u.role === "ADMIN" &&
        u.status === "ACTIVE" &&
        (role !== "ADMIN" || status !== "ACTIVE")
      ) {
        const {
          rows: [count],
        } = await db.query(
          "SELECT count(*)::int n FROM users WHERE role='ADMIN' AND status='ACTIVE'",
        );
        if (count.n <= 1) fail(409, "Keep at least one active administrator");
      }
      await db.query(
        "UPDATE users SET name=$1,role=$2,status=$3,updated_at=now() WHERE id=$4",
        [patch.name ?? u.name, role, status, id],
      );
      if (role !== u.role)
        await audit(db, req, "USER_ROLE_CHANGED", "user", id, {
          old_role: u.role,
          new_role: role,
        });
      if (status !== u.status)
        await audit(
          db,
          req,
          status === "ACTIVE" ? "USER_ENABLED" : "USER_DISABLED",
          "user",
          id,
        );
      if (patch.name && patch.name !== u.name)
        await audit(db, req, "USER_UPDATED", "user", id);
      if (role !== u.role || status !== u.status) {
        await revokeSessions(db, id);
        await audit(db, req, "SESSIONS_REVOKED", "user", id);
      }
      if (status === "DISABLED")
        await db.query(
          "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
          [id],
        );
    });
  }
  r.patch("/:id", async (req, res) => {
    await change(
      req,
      parse(
        z.object({
          name: text(150).optional(),
          role: roles.optional(),
          status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        }),
        req.body,
      ),
    );
    res.json({ ok: true });
  });
  for (const action of ["enable", "disable"])
    r.post(`/:id/${action}`, async (req, res) => {
      await change(req, {
        status: action === "enable" ? "ACTIVE" : "DISABLED",
      });
      res.json({ ok: true });
    });
  r.post("/:id/send-password-reset", async (req, res) => {
    const id = uuid(req.params.id);
    if (mailer.available) {
      await sendToken(pool, config, mailer, id, "PASSWORD_RESET", req);
      return res.json({ message: "Password reset email sent" });
    }
    const temp = temporaryPassword();
    await transaction(pool, async (db) => {
      const {
        rows: [u],
      } = await db.query("SELECT id,status FROM users WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (!u || u.status !== "ACTIVE")
        fail(400, "An active account is required");
      await db.query(
        "UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2",
        [await bcrypt.hash(temp, 12), id],
      );
      await db.query(
        "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [id],
      );
      await revokeSessions(db, id);
      await audit(db, req, "TEMPORARY_PASSWORD_CREATED", "user", id);
      await audit(db, req, "SESSIONS_REVOKED", "user", id);
    });
    res.json({ temporaryPassword: temp });
  });
  return r;
}
