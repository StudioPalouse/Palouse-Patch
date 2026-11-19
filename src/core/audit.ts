import { and, desc, eq, lt } from "drizzle-orm";
import { auditEvents } from "../db/schema.ts";
import type { Ctx, Tx } from "./context.ts";

type AuditInput = {
  action: "create" | "update" | "delete";
  entityType: string;
  entityId: string;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }> | Record<string, unknown> | null;
};

export async function recordAudit(tx: Tx, ctx: Ctx, input: AuditInput) {
  await tx.insert(auditEvents).values({
    organizationId: ctx.orgId,
    actorType: ctx.actor.type,
    actorUserId: ctx.actor.userId,
    actorLabel: ctx.actor.label,
    ...input,
    changes: input.changes ?? null,
  });
}

/** Field-level diff for update events. Ignores timestamps. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt" || key === "createdAt") continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}

export async function listAudit(
  ctx: Ctx,
  opts: { entityType?: string; entityId?: string; before?: Date; limit?: number } = {},
) {
  const filters = [eq(auditEvents.organizationId, ctx.orgId)];
  if (opts.entityType) filters.push(eq(auditEvents.entityType, opts.entityType));
  if (opts.entityId) filters.push(eq(auditEvents.entityId, opts.entityId));
  if (opts.before) filters.push(lt(auditEvents.createdAt, opts.before));
  return ctx.db
    .select()
    .from(auditEvents)
    .where(and(...filters))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}
