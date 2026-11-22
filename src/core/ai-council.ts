import { and, asc, eq, inArray, max } from "drizzle-orm";
import { aiReviewStageMembers, aiReviewStages, member, user } from "../db/schema.ts";
import { aiReviewStageInput, type AiReviewStageInput } from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import { requireRole } from "./authz.ts";
import type { Ctx, Tx } from "./context.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";

type DbLike = Ctx["db"] | Tx;

async function assertMembers(tx: Tx, orgId: string, userIds: string[]) {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return wanted;
  const found = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), inArray(member.userId, wanted)));
  if (found.length !== wanted.length) throw badRequest("Council reviewers must be members of this organization");
  return wanted;
}

/** Stage reviewers who are still members of the org. */
export async function stageMembers(db: DbLike, orgId: string, stageIds: string[]) {
  if (stageIds.length === 0) return [];
  return db
    .select({ stageId: aiReviewStageMembers.stageId, userId: user.id, name: user.name, email: user.email })
    .from(aiReviewStageMembers)
    .innerJoin(user, eq(user.id, aiReviewStageMembers.userId))
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, orgId)))
    .where(and(eq(aiReviewStageMembers.organizationId, orgId), inArray(aiReviewStageMembers.stageId, stageIds)))
    .orderBy(asc(user.name));
}

export async function orgAdmins(db: DbLike, orgId: string) {
  return db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), inArray(member.role, ["admin", "owner"])))
    .orderBy(asc(user.name));
}

export async function listStages(ctx: Ctx) {
  const stages = await ctx.db
    .select()
    .from(aiReviewStages)
    .where(eq(aiReviewStages.organizationId, ctx.orgId))
    .orderBy(asc(aiReviewStages.position), asc(aiReviewStages.createdAt));
  const members = await stageMembers(
    ctx.db,
    ctx.orgId,
    stages.map((s) => s.id),
  );
  return stages.map((s) => ({ ...s, members: members.filter((m) => m.stageId === s.id) }));
}

export async function isCouncilMember(db: DbLike, orgId: string, userId: string) {
  const [row] = await db
    .select({ userId: aiReviewStageMembers.userId })
    .from(aiReviewStageMembers)
    .where(and(eq(aiReviewStageMembers.organizationId, orgId), eq(aiReviewStageMembers.userId, userId)))
    .limit(1);
  return !!row;
}

/** Governance records (AI profiles, capability rulings) are for the council and admins. */
export async function requireCouncilOrAdmin(ctx: Ctx) {
  if (ctx.role === "admin" || ctx.role === "owner") return;
  if (!(await isCouncilMember(ctx.db, ctx.orgId, ctx.actor.userId)))
    throw forbidden("Only AI council members and admins can do that");
}

export async function createStage(ctx: Ctx, input: AiReviewStageInput) {
  requireRole(ctx, "admin");
  const data = aiReviewStageInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const memberIds = await assertMembers(tx, ctx.orgId, data.memberUserIds);
    const [{ last } = { last: null }] = await tx
      .select({ last: max(aiReviewStages.position) })
      .from(aiReviewStages)
      .where(eq(aiReviewStages.organizationId, ctx.orgId));
    const [row] = await tx
      .insert(aiReviewStages)
      .values({
        organizationId: ctx.orgId,
        name: data.name,
        description: data.description,
        rule: data.rule,
        minTier: data.minTier,
        position: (last ?? 0) + 1,
      })
      .returning();
    if (memberIds.length)
      await tx
        .insert(aiReviewStageMembers)
        .values(memberIds.map((userId) => ({ stageId: row!.id, userId, organizationId: ctx.orgId })));
    await recordAudit(tx, ctx, {
      action: "create",
      entityType: "ai_council",
      entityId: row!.id,
      summary: `Added AI council stage "${row!.name}"`,
      changes: { memberUserIds: memberIds },
    });
    return row!;
  });
}

export async function updateStage(ctx: Ctx, id: string, input: AiReviewStageInput) {
  requireRole(ctx, "admin");
  const data = aiReviewStageInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const before = await tx.query.aiReviewStages.findFirst({
      where: and(eq(aiReviewStages.id, id), eq(aiReviewStages.organizationId, ctx.orgId)),
    });
    if (!before) throw notFound("Stage");
    const memberIds = await assertMembers(tx, ctx.orgId, data.memberUserIds);
    const [row] = await tx
      .update(aiReviewStages)
      .set({ name: data.name, description: data.description, rule: data.rule, minTier: data.minTier })
      .where(eq(aiReviewStages.id, id))
      .returning();
    const previous = await tx
      .select({ userId: aiReviewStageMembers.userId })
      .from(aiReviewStageMembers)
      .where(eq(aiReviewStageMembers.stageId, id));
    await tx.delete(aiReviewStageMembers).where(eq(aiReviewStageMembers.stageId, id));
    if (memberIds.length)
      await tx.insert(aiReviewStageMembers).values(memberIds.map((userId) => ({ stageId: id, userId, organizationId: ctx.orgId })));
    const changes: Record<string, unknown> = diff(before, row!);
    const prevIds = previous.map((p) => p.userId).sort();
    if (JSON.stringify(prevIds) !== JSON.stringify([...memberIds].sort()))
      changes.memberUserIds = { from: prevIds, to: memberIds };
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "ai_council",
      entityId: id,
      summary: `Updated AI council stage "${row!.name}"`,
      changes,
    });
    return row!;
  });
}

export async function deleteStage(ctx: Ctx, id: string) {
  requireRole(ctx, "admin");
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(aiReviewStages)
      .where(and(eq(aiReviewStages.id, id), eq(aiReviewStages.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Stage");
    await recordAudit(tx, ctx, {
      action: "delete",
      entityType: "ai_council",
      entityId: id,
      summary: `Removed AI council stage "${row.name}"`,
    });
  });
}

/** Set the review order. `ids` must list every stage exactly once. */
export async function reorderStages(ctx: Ctx, ids: string[]) {
  requireRole(ctx, "admin");
  await ctx.db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: aiReviewStages.id })
      .from(aiReviewStages)
      .where(eq(aiReviewStages.organizationId, ctx.orgId));
    const known = new Set(existing.map((s) => s.id));
    if (!Array.isArray(ids) || ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((i) => known.has(i)))
      throw badRequest("Send every stage id exactly once");
    for (const [i, stageId] of ids.entries())
      await tx.update(aiReviewStages).set({ position: i + 1 }).where(eq(aiReviewStages.id, stageId));
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "ai_council",
      entityId: ctx.orgId,
      summary: "Changed the AI council review order",
      changes: { order: ids },
    });
  });
}
