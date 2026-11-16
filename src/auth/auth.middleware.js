import { randomBytes, timingSafeEqual } from "node:crypto";
import { fail } from "../middleware/validation.js";
export function authMiddleware(pool) {
  return async (req, res, next) => {
    if (!req.session?.userId) return next();
    const {
      rows: [user],
    } = await pool.query(
      "SELECT id,name,email,role,status,must_change_password,session_version FROM users WHERE id=$1",
      [req.session.userId],
    );
    if (
      !user ||
      user.status !== "ACTIVE" ||
      user.session_version !== req.session.version
    ) {
      await new Promise((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      return next();
    }
    req.user = user;
    next();
  };
}
export const requireAuth = (req, res, next) => {
  if (!req.user) fail(401, "Unauthorized");
  next();
};
export const requireReady = (req, res, next) => {
  if (req.user.must_change_password)
    fail(403, "Change your temporary password before continuing");
  next();
};
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) fail(403, "Forbidden");
    next();
  };
export function csrf(config) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.headers.origin && req.headers.origin !== config.appUrl)
      fail(403, "Invalid request origin");
    if (req.headers["sec-fetch-site"] === "cross-site")
      fail(403, "Cross-site request blocked");
    const expected = req.session?.csrfToken || "";
    const provided = String(req.headers["x-csrf-token"] || "");
    if (
      !expected ||
      Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    )
      fail(403, "Refresh the page and try again");
    next();
  };
}
export function csrfToken(req) {
  return (req.session.csrfToken ||= randomBytes(32).toString("hex"));
}
export async function revokeSessions(db, userId) {
  await db.query(
    "UPDATE users SET session_version=session_version+1,updated_at=now() WHERE id=$1",
    [userId],
  );
  await db.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [userId]);
}
