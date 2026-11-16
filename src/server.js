import { readConfig } from "./config/env.js";
import { createPool, bindEnvironment } from "./config/database.js";
import { createApp } from "./app.js";
const config = readConfig(),
  pool = createPool(config);
await bindEnvironment(pool, config);
const app = createApp({ pool, config });
const server = app.listen(config.port, config.host, () =>
  console.log(`fbr-digital-invoice ${config.appEnv} listening on ${config.appUrl}`),
);
async function stop() {
  server.close(async () => {
    app.locals.sessionStore.close();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
