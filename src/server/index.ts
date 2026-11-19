import { serve } from "@hono/node-server";
import { sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { createApp } from "./app.ts";
import { config } from "./config.ts";

if (config.autoMigrate) {
  await runMigrations();
  console.log("Database migrations applied");
}

const server = serve({ fetch: createApp().fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Patch listening on http://0.0.0.0:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    sql.end({ timeout: 5 }).finally(() => process.exit(0));
  });
}
