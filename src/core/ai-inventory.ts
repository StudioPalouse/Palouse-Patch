import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { aiCapabilities, aiProfiles, aiRequests, aiTeamRollouts, aiUsageSnapshots, systems, teams } from "../db/schema.ts";
import {
  aiCapabilityInput,
  aiProfileInput,
  rolloutInput,
  usageSnapshotInput,
  type AiCapabilityInput,
  type AiProfileInput,
  type UsageSnapshotInput,
} from "../shared/domain.ts";
import { requireCouncilOrAdmin } from "./ai-council.ts";
import { diff, recordAudit } from "./audit.ts";
import type { Ctx, Tx } from "./context.ts";
import { badRequest, notFound } from "./errors.ts";

type DbLike = Ctx["db"] | Tx;

async function loadSystem(db: DbLike, ctx: Ctx, systemId: string) {
  const system = await db.query.systems.findFirst({
    where: and(eq(systems.id, systemId), eq(systems.organizationId, ctx.orgId)),
  });
  if (!system) throw notFound("System");
  return system;
}

async function requireProfile(db: DbLike, systemId: string) {
  const [profile] = await db.select().from(aiProfiles).where(eq(aiProfiles.systemId, systemId));
  if (!profile) throw badRequest("Add this system to the AI inventory first");
  return profile;
}

/** Active users over seats, falling back to the expected user count. */
export function adoptionRate(activeUsers: number | null | undefined, seats: number | null | undefined, targetUsers: number | null | undefined) {
  const denominator = seats || targetUsers;
  if (activeUsers == null || !denominator) return null;
  return Math.min(1, activeUsers / denominator);
}

/** Every system with an AI profile, with capability, adoption and rollout rollups. */
export async function listInventory(ctx: Ctx) {
  const rows = await ctx.db
    .select({ profile: aiProfiles, system: systems })
    .from(aiProfiles)
    .innerJoin(systems, eq(systems.id, aiProfiles.systemId))
    .where(eq(aiProfiles.organizationId, ctx.orgId))
    .orderBy(asc(systems.name));
  const ids = rows.map((r) => r.system.id);
  const [caps, latest, rollouts, [teamTotal], openRequests, decided] = await Promise.all([
    ids.length
      ? ctx.db
          .select({ systemId: aiCapabilities.systemId, status: aiCapabilities.status, n: count() })
          .from(aiCapabilities)
          .where(inArray(aiCapabilities.systemId, ids))
          .groupBy(aiCapabilities.systemId, aiCapabilities.status)
      : [],
    ids.length
      ? ctx.db
          .selectDistinctOn([aiUsageSnapshots.systemId])
          .from(aiUsageSnapshots)
          .where(inArray(aiUsageSnapshots.systemId, ids))
          .orderBy(aiUsageSnapshots.systemId, desc(aiUsageSnapshots.recordedOn))
      : [],
    ids.length
      ? ctx.db
          .select({ systemId: aiTeamRollouts.systemId, status: aiTeamRollouts.status, n: count() })
          .from(aiTeamRollouts)
          .where(inArray(aiTeamRollouts.systemId, ids))
          .groupBy(aiTeamRollouts.systemId, aiTeamRollouts.status)
      : [],
    ctx.db.select({ n: count() }).from(teams).where(eq(teams.organizationId, ctx.orgId)),
    ctx.db
      .select({ n: count() })
      .from(aiRequests)
      .where(and(eq(aiRequests.organizationId, ctx.orgId), inArray(aiRequests.status, ["in_review", "changes_requested"]))),
    ctx.db
      .select({
        n: count(),
        avgDays: sql<string | null>`avg(extract(epoch from ${aiRequests.decidedAt} - ${aiRequests.submittedAt}) / 86400)`,
      })
      .from(aiRequests)
      .where(and(eq(aiRequests.organizationId, ctx.orgId), inArray(aiRequests.status, ["approved", "rejected"]))),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const tools = rows.map(({ profile, system }) => {
    const capOf = (status: string) => caps.find((c) => c.systemId === system.id && c.status === status)?.n ?? 0;
    const snap = latest.find((s) => s.systemId === system.id);
    const teamsOf = (status: string) => rollouts.find((r) => r.systemId === system.id && r.status === status)?.n ?? 0;
    return {
      systemId: system.id,
      name: system.name,
      vendor: system.vendor,
      lifecycle: system.lifecycle,
      riskTier: profile.riskTier,
      approvedAt: profile.approvedAt,
      reviewDueAt: profile.reviewDueAt,
      reviewOverdue: !!profile.reviewDueAt && profile.reviewDueAt < today,
      capabilities: { approved: capOf("approved"), restricted: capOf("restricted"), prohibited: capOf("prohibited") },
      latestUsage: snap ? { recordedOn: snap.recordedOn, activeUsers: snap.activeUsers, licensedSeats: snap.licensedSeats } : null,
      adoptionRate: adoptionRate(snap?.activeUsers, snap?.licensedSeats, profile.targetUsers),
      teams: { adopted: teamsOf("adopted"), piloting: teamsOf("piloting"), total: teamTotal?.n ?? 0 },
    };
  });

  const measured = tools.filter((t) => t.adoptionRate !== null);
  return {
    tools,
    summary: {
      tools: tools.length,
      approvedCapabilities: tools.reduce((n, t) => n + t.capabilities.approved + t.capabilities.restricted, 0),
      openRequests: openRequests[0]?.n ?? 0,
      decidedRequests: decided[0]?.n ?? 0,
      avgDaysToDecision: decided[0]?.avgDays != null ? Math.round(Number(decided[0].avgDays) * 10) / 10 : null,
      averageAdoption: measured.length ? measured.reduce((n, t) => n + t.adoptionRate!, 0) / measured.length : null,
      reviewsOverdue: tools.filter((t) => t.reviewOverdue).length,
    },
  };
}

/** AI governance and adoption details for one system (profile may be null). */
export async function getAiDetails(ctx: Ctx, systemId: string) {
  await loadSystem(ctx.db, ctx, systemId);
  const [[profile], capabilities, usage, rollouts, allTeams, requests] = await Promise.all([
    ctx.db.select().from(aiProfiles).where(eq(aiProfiles.systemId, systemId)),
    ctx.db.select().from(aiCapabilities).where(eq(aiCapabilities.systemId, systemId)).orderBy(asc(aiCapabilities.name)),
    ctx.db.select().from(aiUsageSnapshots).where(eq(aiUsageSnapshots.systemId, systemId)).orderBy(desc(aiUsageSnapshots.recordedOn)).limit(52),
    ctx.db.select().from(aiTeamRollouts).where(eq(aiTeamRollouts.systemId, systemId)),
    ctx.db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.organizationId, ctx.orgId)).orderBy(asc(teams.name)),
    ctx.db
      .select({ id: aiRequests.id, title: aiRequests.title, capability: aiRequests.capability, status: aiRequests.status, submittedAt: aiRequests.submittedAt })
      .from(aiRequests)
      .where(and(eq(aiRequests.organizationId, ctx.orgId), or(eq(aiRequests.systemId, systemId), eq(aiRequests.resultSystemId, systemId))))
      .orderBy(desc(aiRequests.submittedAt)),
  ]);
  const latest = usage[0];
  return {
    profile: profile ?? null,
    capabilities,
    usage,
    adoptionRate: adoptionRate(latest?.activeUsers, latest?.licensedSeats, profile?.targetUsers),
    rollouts: allTeams.map((t) => {
      const r = rollouts.find((x) => x.teamId === t.id);
      return { teamId: t.id, teamName: t.name, status: r?.status ?? "not_started", adoptedAt: r?.adoptedAt ?? null };
    }),
    requests,
  };
}

/** Add a system to the AI inventory, or update its governance details. */
export async function saveAiProfile(ctx: Ctx, systemId: string, input: AiProfileInput) {
  await requireCouncilOrAdmin(ctx);
  const data = aiProfileInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    const [before] = await tx.select().from(aiProfiles).where(eq(aiProfiles.systemId, systemId));
    if (before) {
      const [row] = await tx.update(aiProfiles).set(data).where(eq(aiProfiles.id, before.id)).returning();
      await recordAudit(tx, ctx, {
        action: "update",
        entityType: "system",
        entityId: systemId,
        summary: `Updated the AI profile of "${system.name}"`,
        changes: diff(before, row!),
      });
      return row!;
    }
    const [row] = await tx.insert(aiProfiles).values({ ...data, organizationId: ctx.orgId, systemId }).returning();
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "system",
      entityId: systemId,
      summary: `Added "${system.name}" to the AI inventory`,
    });
    return row!;
  });
}

export async function removeAiProfile(ctx: Ctx, systemId: string) {
  await requireCouncilOrAdmin(ctx);
  await ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    const [row] = await tx.delete(aiProfiles).where(eq(aiProfiles.systemId, systemId)).returning();
    if (!row) throw notFound("AI profile");
    await recordAudit(tx, ctx, { action: "update", entityType: "system", entityId: systemId, summary: `Removed "${system.name}" from the AI inventory` });
  });
}

export async function addCapability(ctx: Ctx, systemId: string, input: AiCapabilityInput) {
  await requireCouncilOrAdmin(ctx);
  const data = aiCapabilityInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    await requireProfile(tx, systemId);
    const [row] = await tx.insert(aiCapabilities).values({ ...data, organizationId: ctx.orgId, systemId }).returning();
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "system",
      entityId: systemId,
      summary: `Marked AI capability "${row!.name}" of "${system.name}" as ${row!.status}`,
    });
    return row!;
  });
}

export async function updateCapability(ctx: Ctx, systemId: string, capabilityId: string, input: AiCapabilityInput) {
  await requireCouncilOrAdmin(ctx);
  const data = aiCapabilityInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    const [before] = await tx
      .select()
      .from(aiCapabilities)
      .where(and(eq(aiCapabilities.id, capabilityId), eq(aiCapabilities.systemId, systemId), eq(aiCapabilities.organizationId, ctx.orgId)));
    if (!before) throw notFound("Capability");
    const [row] = await tx.update(aiCapabilities).set(data).where(eq(aiCapabilities.id, capabilityId)).returning();
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "system",
      entityId: systemId,
      summary: `Updated AI capability "${row!.name}" of "${system.name}"`,
      changes: diff(before, row!),
    });
    return row!;
  });
}

export async function deleteCapability(ctx: Ctx, systemId: string, capabilityId: string) {
  await requireCouncilOrAdmin(ctx);
  await ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    const [row] = await tx
      .delete(aiCapabilities)
      .where(and(eq(aiCapabilities.id, capabilityId), eq(aiCapabilities.systemId, systemId), eq(aiCapabilities.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Capability");
    await recordAudit(tx, ctx, { action: "update", entityType: "system", entityId: systemId, summary: `Removed AI capability "${row.name}" from "${system.name}"` });
  });
}

/** Record usage for a day (replaces an earlier figure for the same day). Open to all members and API tokens. */
export async function recordUsage(ctx: Ctx, systemId: string, input: UsageSnapshotInput) {
  const data = usageSnapshotInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    await requireProfile(tx, systemId);
    const [row] = await tx
      .insert(aiUsageSnapshots)
      .values({ ...data, organizationId: ctx.orgId, systemId })
      .onConflictDoUpdate({
        target: [aiUsageSnapshots.systemId, aiUsageSnapshots.recordedOn],
        set: { activeUsers: data.activeUsers, licensedSeats: data.licensedSeats },
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "system",
      entityId: systemId,
      summary: `Recorded ${data.activeUsers} active users of "${system.name}" on ${data.recordedOn}`,
    });
    return row!;
  });
}

export async function deleteUsage(ctx: Ctx, systemId: string, snapshotId: string) {
  await ctx.db.transaction(async (tx) => {
    await loadSystem(tx, ctx, systemId);
    const [row] = await tx
      .delete(aiUsageSnapshots)
      .where(and(eq(aiUsageSnapshots.id, snapshotId), eq(aiUsageSnapshots.systemId, systemId), eq(aiUsageSnapshots.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Usage record");
  });
}

export async function setRollout(ctx: Ctx, systemId: string, teamId: string, input: { status: string }) {
  const { status } = rolloutInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const system = await loadSystem(tx, ctx, systemId);
    await requireProfile(tx, systemId);
    const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.organizationId, ctx.orgId)) });
    if (!team) throw notFound("Team");
    const [before] = await tx
      .select()
      .from(aiTeamRollouts)
      .where(and(eq(aiTeamRollouts.systemId, systemId), eq(aiTeamRollouts.teamId, teamId)));
    const adoptedAt = status === "adopted" ? (before?.status === "adopted" ? before.adoptedAt : new Date()) : null;
    const [row] = await tx
      .insert(aiTeamRollouts)
      .values({ organizationId: ctx.orgId, systemId, teamId, status, adoptedAt })
      .onConflictDoUpdate({ target: [aiTeamRollouts.systemId, aiTeamRollouts.teamId], set: { status, adoptedAt } })
      .returning();
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "system",
      entityId: systemId,
      summary: `Set ${team.name}'s rollout of "${system.name}" to ${status.replace("_", " ")}`,
      changes: { rollout: { teamId, from: before?.status ?? "not_started", to: status } },
    });
    return row!;
  });
}
