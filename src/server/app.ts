import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { secureHeaders } from "hono/secure-headers";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { sql } from "../db/client.ts";
import { AppError } from "../core/errors.ts";
import { api } from "./api.ts";
import { auth, mcpOAuthEnabled } from "./auth.ts";
import { config } from "./config.ts";
import { handleMcp } from "./mcp.ts";
import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { setNotifier } from "../core/notify.ts";
import { actionEmail, sendMail } from "./mail.ts";

const webRoot = fileURLToPath(new URL("../../dist/web", import.meta.url));

export function createApp() {
  const app = new Hono();

  // Core services raise notifications (AI council reviews); deliver them by email.
  setNotifier(({ path, ...n }) => sendMail(actionEmail({ ...n, url: `${config.baseUrl}${path}` })));

  app.use("*", secureHeaders());

  app.get("/healthz", async (c) => {
    await sql`select 1`;
    return c.json({ ok: true });
  });

  app.get("/api/config", (c) => c.json({ allowSignup: config.allowSignup, mailEnabled: !!config.resendApiKey, requireWorkEmail: config.requireWorkEmail }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  // OAuth discovery for MCP clients. Better Auth serves the protected resource
  // metadata (/.well-known/oauth-protected-resource[/mcp]) and the
  // authorization server metadata at its path-inserted URL
  // (/.well-known/oauth-authorization-server/api/auth); the path-inserted
  // OpenID configuration needs its own route. Public documents, so any origin
  // may read them (browser-based MCP clients fetch them cross-origin).
  if (mcpOAuthEnabled) {
    const openIdConfig = oauthProviderOpenIdConfigMetadata(auth, { headers: { "access-control-allow-origin": "*" } });
    app.get("/.well-known/openid-configuration/api/auth", (c) => openIdConfig(c.req.raw));
    app.get("/.well-known/*", async (c) => {
      const res = await auth.handler(c.req.raw);
      const out = new Response(res.body, res);
      out.headers.set("access-control-allow-origin", "*");
      return out;
    });
  }
  app.get("/.well-known/*", (c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
  app.route("/api/v1", api);
  app.all("/mcp", handleMcp);
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
