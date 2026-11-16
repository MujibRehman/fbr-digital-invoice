import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import bcrypt from "bcrypt";
import { z } from "zod";
import { readConfig } from "../src/config/env.js";
import {
  createPool,
  transaction,
  bindEnvironment,
} from "../src/config/database.js";
import { parse, email, password, text } from "../src/middleware/validation.js";
import { audit } from "../src/audit/audit.service.js";
const config = readConfig(),
  pool = createPool(config);
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  if (!process.stdin.isTTY)
    throw new Error("Run create-admin from an interactive terminal");
  await bindEnvironment(pool, config);
  const name = await rl.question("Admin name: "),
    address = await rl.question("Admin email: ");
  process.stdout.write("Initial password (hidden): ");
  muted = true;
  const secret = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  const input = parse(z.object({ name: text(150), email, password }), {
    name,
    email: address,
    password: secret,
  });
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(8675311)");
    if ((await db.query("SELECT 1 FROM users WHERE role='ADMIN'")).rowCount)
      throw new Error("An administrator already exists. Use User Management.");
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,name,email,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,'ADMIN',true)",
      [id, input.name, input.email, await bcrypt.hash(input.password, 12)],
    );
    await audit(db, null, "INITIAL_ADMIN_CREATED", "user", id);
  });
  console.log(
    "Administrator created. Sign in and replace the initial password.",
  );
} catch (error) {
  console.error(
    error.code
      ? "Administrator creation failed. Check database access."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  rl.close();
  await pool.end();
}
