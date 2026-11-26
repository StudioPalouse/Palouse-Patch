import { and, eq } from "drizzle-orm";
import { member, user } from "../db/schema.ts";
import { recordAudit } from "./audit.ts";
import { requireRole, requireWritable } from "./authz.ts";
import type { Ctx } from "./context.ts";
import { notFound } from "./errors.ts";

/**
 * Send a password reset link to another member of the caller's org. Admin and
 * owner only. The link goes to the member's own inbox, so this never gives the
 * admin access to the account. `send` does the actual delivery (Better Auth),
 * keeping core free of server dependencies.
 */
export async function sendMemberPasswordReset(ctx: Ctx, userId: string, send: (email: string) => Promise<void>) {
  requireRole(ctx, "admin");
  requireWritable(ctx);
  const [target] = await ctx.db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)));
  if (!target) throw notFound("Member");

  await send(target.email);
  await ctx.db.transaction((tx) =>
    recordAudit(tx, ctx, {
      action: "update",
      entityType: "member",
      entityId: target.id,
      summary: `Sent a password reset email to ${target.name}`,
    }),
  );
  return { email: target.email };
}
