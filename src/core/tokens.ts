import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { apiTokens, member, oauthClient, user } from "../db/schema.ts";
import { apiTokenInput } from "../shared/domain.ts";
import { OAUTH_READ_ONLY_MESSAGE, readOnlyDb, type Ctx, type OrgRole } from "./context.ts";
import { notFound } from "./errors.ts";

const PREFIX = "patch_";
/** Patch API tokens start with `patch_`; any other bearer token is treated as OAuth. */
export const isApiToken = (token: string) => token.startsWith(PREFIX);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create a token for the calling user. The plaintext is returned only once. */
export async function createApiToken(ctx: Ctx, input: { name: string; scope?: "read" | "write"; expiresInDays?: number | null }) {
  const data = apiTokenInput.parse(input);
  const secret = PREFIX + randomBytes(24).toString("base64url");
  const expiresAt = data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null;
  const [row] = await ctx.db
    .insert(apiTokens)
    .values({
      organizationId: ctx.orgId,
      userId: ctx.actor.userId,
      name: data.name,
      scope: data.scope,
      prefix: secret.slice(0, PREFIX.length + 6),
      tokenHash: hash(secret),
      expiresAt,
    })
    .returning();
  const { tokenHash, ...safe } = row!;
  return { ...safe, token: secret };
}

export async function listApiTokens(ctx: Ctx) {
  return ctx.db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scope: apiTokens.scope,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.organizationId, ctx.orgId), eq(apiTokens.userId, ctx.actor.userId)))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.organizationId, ctx.orgId),
        eq(apiTokens.userId, ctx.actor.userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });
  if (!row) throw notFound("Token");
}

/**
 * Resolve a bearer token to an org context. The token's user must still be a
 * member of the org; role is read live so demotions take effect immediately.
 */
export async function verifyApiToken(db: DB, token: string) {
  if (!token.startsWith(PREFIX)) return null;
  const now = new Date();
  const [row] = await db
    .select({ token: apiTokens, role: member.role, userName: user.name })
    .from(apiTokens)
    .innerJoin(member, and(eq(member.userId, apiTokens.userId), eq(member.organizationId, apiTokens.organizationId)))
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hash(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    );
  if (!row) return null;
  // Best effort; avoid a write on every request by only updating once a minute.
  if (!row.token.lastUsedAt || now.getTime() - row.token.lastUsedAt.getTime() > 60_000) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.token.id));
  }
  return {
    orgId: row.token.organizationId,
    userId: row.token.userId,
    role: row.role as OrgRole,
    scope: row.token.scope,
    label: `${row.userName} (token: ${row.token.name})`,
  };
}

/** Build the core context for a bearer token. Read-only tokens get a database handle that refuses writes. */
export async function ctxFromApiToken(db: DB, token: string): Promise<Ctx | null> {
  const resolved = await verifyApiToken(db, token);
  if (!resolved) return null;
  const readOnly = resolved.scope === "read";
  return {
    db: readOnly ? readOnlyDb(db) : db,
    orgId: resolved.orgId,
    role: resolved.role,
    actor: { type: "token", userId: resolved.userId, label: resolved.label },
    ...(readOnly ? { readOnly } : {}),
  };
}

/**
 * Build the core context for a verified OAuth access token (an MCP client the
 * user connected by signing in). Like API tokens, membership and role are read
 * live, so removing someone from the org cuts off their connected clients at
 * once. Without the `patch:write` scope the database handle refuses writes.
 */
export async function ctxFromOAuth(
  db: DB,
  grant: { userId: string; orgId: string; clientId: string; scopes: string[] },
): Promise<Ctx | null> {
  const [row] = await db
    .select({ role: member.role, userName: user.name, clientName: oauthClient.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(oauthClient, eq(oauthClient.clientId, grant.clientId))
    .where(and(eq(member.userId, grant.userId), eq(member.organizationId, grant.orgId)));
  if (!row) return null;
  const readOnly = !grant.scopes.includes("patch:write");
  return {
    db: readOnly ? readOnlyDb(db, OAUTH_READ_ONLY_MESSAGE) : db,
    orgId: grant.orgId,
    role: row.role as OrgRole,
    actor: { type: "oauth", userId: grant.userId, label: `${row.userName} (via ${row.clientName || "an MCP client"})` },
    ...(readOnly ? { readOnly } : {}),
  };
}
