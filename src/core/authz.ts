import type { Ctx, OrgRole } from "./context.ts";
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
