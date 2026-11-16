import { z } from "zod";
export const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
export const text = (max = 255) => z.string().trim().min(1).max(max);
export const optionalText = (max = 100) =>
  z.string().trim().max(max).default("");
export const email = z.string().trim().toLowerCase().max(255).pipe(z.email());
export const password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (v) =>
      Buffer.byteLength(v) <= 72 &&
      /[a-z]/.test(v) &&
      /[A-Z]/.test(v) &&
      /\d/.test(v) &&
      /[^a-zA-Z0-9]/.test(v),
    "Use 12–72 bytes with uppercase, lowercase, a number and a symbol",
  );
export const roles = z.enum(["ADMIN", "ACCOUNTANT", "VIEWER"]);
export function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success)
    fail(
      400,
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export function uuid(value) {
  return parse(z.uuid(), value);
}
export function page(query, limit = 50) {
  return {
    limit,
    offset:
      (Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1))) - 1) *
      limit,
  };
}
