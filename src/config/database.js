import pg from "pg";
// Invoice dates are calendar dates, not instants; keep them independent of host timezone.
pg.types.setTypeParser(1082, (value) => value);
export function createPool(config) {
  return new pg.Pool({ connectionString: config.databaseUrl, max: 15 });
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function bindEnvironment(pool, config) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(8675309)");
    const { rows } = await db.query(
      "SELECT environment FROM app_identity WHERE singleton = true",
    );
    if (rows.length && rows[0].environment !== config.appEnv)
      throw new Error("Database is bound to another environment");
    if (!rows.length)
      await db.query(
        "INSERT INTO app_identity(singleton, environment) VALUES(true,$1)",
        [config.appEnv],
      );
  });
}
