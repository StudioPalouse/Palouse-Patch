import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { secureHeaders } from "hono/secure-headers";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { sql } from "../db/client.ts";
import { AppError } from "../core/errors.ts";
import { api } from "./api.ts";
import { auth } from "./auth.ts";
import { config } from "./config.ts";

const webRoot = fileURLToPath(new URL("../../dist/web", import.meta.url));

export function createApp() {
  const app = new Hono();

  app.use("*", secureHeaders());

  app.get("/healthz", async (c) => {
    await sql`select 1`;
    return c.json({ ok: true });
  });

  app.get("/api/config", (c) => c.json({ allowSignup: config.allowSignup, mailEnabled: !!config.resendApiKey, requireWorkEmail: config.requireWorkEmail }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api/v1", api);
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  // Single page app: static assets, then index.html for client-side routes.
  if (existsSync(webRoot)) {
    const indexHtml = readFileSync(`${webRoot}/index.html`, "utf8");
    app.use("/assets/*", serveStatic({ root: webRoot }));
    app.use("*", serveStatic({ root: webRoot }));
    app.get("*", (c) => c.html(indexHtml));
  }

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    }
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of err.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      return c.json({ error: { code: "validation_error", message: "Please check the highlighted fields", fields } }, 422);
    }
    console.error(err);
    return c.json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
  });

  return app;
}
