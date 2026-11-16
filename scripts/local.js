import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import { parse } from "dotenv";
import { migrate } from "./migrate.js";
import { createPool, bindEnvironment } from "../src/config/database.js";
import { readConfig } from "../src/config/env.js";
const dir = resolve(".local");
await mkdir(dir, { recursive: true, mode: 0o700 });
const credPath = resolve(dir, "database.json");
let dbConfig;
if (existsSync(credPath))
  dbConfig = JSON.parse(await readFile(credPath, "utf8"));
else {
  dbConfig = {
    user: "fbr_digital_invoice",
    password: randomBytes(24).toString("hex"),
    port: 55439,
  };
  await writeFile(credPath, JSON.stringify(dbConfig), { mode: 0o600 });
}
if (!existsSync(".env")) {
  let sample = await readFile(".env.example", "utf8");
  sample = sample
    .replace(
      "postgres://fbr_digital_invoice:REPLACE_PASSWORD@127.0.0.1:5432/fbr_digital_invoice_sandbox",
      `postgres://fbr_digital_invoice:${dbConfig.password}@127.0.0.1:${dbConfig.port}/fbr_digital_invoice_sandbox`,
    )
    .replace(
      "REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS",
      randomBytes(48).toString("hex"),
    );
  await writeFile(".env", sample, { mode: 0o600 });
}
const env = parse(await readFile(".env")),
  config = readConfig(env);
if (config.appEnv !== "sandbox" || !config.mock || config.secure)
  throw new Error("local.js is only for the local mock sandbox");
const cluster = new EmbeddedPostgres({
  ...dbConfig,
  databaseDir: resolve(dir, "postgres"),
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(resolve(dir, "postgres/PG_VERSION")))
  await cluster.initialise();
await cluster.start();
let child;
try {
  const c = cluster.getPgClient();
  await c.connect();
  try {
    if (
      !(
        await c.query(
          "SELECT 1 FROM pg_database WHERE datname='fbr_digital_invoice_sandbox'",
        )
      ).rowCount
    )
      await c.query("CREATE DATABASE fbr_digital_invoice_sandbox");
  } finally {
    await c.end();
  }
  const pool = createPool(config);
  try {
    await migrate(pool);
    await bindEnvironment(pool, config);
  } finally {
    await pool.end();
  }
  child = spawn(process.execPath, ["src/server.js"], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  let stopping = false;
  const stop = () => {
    if (!stopping) {
      stopping = true;
      child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(
    "Local sandbox ready. In a second terminal, run npm run create-admin to create your administrator.",
  );
  await new Promise((resolve) => child.on("exit", resolve));
} finally {
  await cluster.stop();
}
