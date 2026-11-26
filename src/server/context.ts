import type { Context, MiddlewareHandler } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { member } from "../db/schema.ts";
import type { Ctx, OrgRole } from "../core/context.ts";
import { AppError } from "../core/errors.ts";
import { ctxFromApiToken } from "../core/tokens.ts";
import { auth } from "./auth.ts";

export type Env = { Variables: { ctx: Ctx } };

/**
 * Resolve the caller to an org context, from either a bearer API token or a
 * browser session. Every /api/v1 route runs behind this.
 */
export const requireOrg: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const ctx = await ctxFromApiToken(db, header.slice(7).trim());
    if (!ctx) throw new AppError(401, "unauthorized", "Invalid or expired API token");
    c.set("ctx", ctx);
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError(401, "unauthorized", "Sign in required");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new AppError(403, "no_organization", "Create or join an organization first");
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)));
  if (!membership) throw new AppError(403, "forbidden", "You are not a member of this organization");
  c.set("ctx", {
    db,
    orgId,
    role: membership.role as OrgRole,
    actor: { type: "user", userId: session.user.id, label: session.user.name },
  });
  return next();
};

export const ctxOf = (c: Context<Env>) => c.get("ctx");
