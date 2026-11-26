import { OAUTH_READ_ONLY_MESSAGE, READ_ONLY_MESSAGE, type Ctx, type OrgRole } from "./context.ts";
import { forbidden } from "./errors.ts";

const rank: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * Every member can read and edit the catalog: Patch is meant to be updated by
 * IT and business teams alike. Admin-only actions (members, tokens for others,
 * org settings) call requireRole(ctx, "admin").
 */
export function requireRole(ctx: Ctx, role: OrgRole) {
  if (rank[ctx.role] < rank[role]) throw forbidden();
}

/**
 * Refuse read-only tokens up front. Database writes are already blocked by the
 * read-only `ctx.db`; call this before side effects that are not writes, such
 * as sending email, so they never happen for a read-only caller.
 */
export function requireWritable(ctx: Ctx) {
  if (ctx.readOnly) throw forbidden(ctx.actor.type === "oauth" ? OAUTH_READ_ONLY_MESSAGE : READ_ONLY_MESSAGE);
}
