import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  aiCapabilities,
  aiProfiles,
  aiRequestEvents,
  aiRequestSteps,
  aiRequests,
  aiReviewStages,
  systems,
  teams,
  user,
} from "../db/schema.ts";
import {
  aiCommentInput,
  aiDecisionInput,
  aiRequestInput,
  assessRisk,
  RISK_TIERS,
  tierRank,
  type AiDecisionInput,
  type AiRequestInput,
  type RiskTier,
} from "../shared/domain.ts";
import { orgAdmins, stageMembers } from "./ai-council.ts";
import { recordAudit } from "./audit.ts";
import type { Ctx, Tx } from "./context.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { notify, type Notice } from "./notify.ts";
import { assertInOrg, textSearch } from "./util.ts";

type DbLike = Ctx["db"] | Tx;
type Step = typeof aiRequestSteps.$inferSelect;
type Request = typeof aiRequests.$inferSelect;
type Reviewer = { userId: string; name: string; email: string };

const OPEN = ["in_review", "changes_requested"];
const ADMIN_STEP = "Admin approval";

const isAdmin = (ctx: Ctx) => ctx.role === "admin" || ctx.role === "owner";

function riskOf(r: Pick<Request, "personalData" | "confidentialData" | "writeAccess" | "autonomous" | "customerFacing" | "peopleDecisions" | "trainsOnData">) {
  return assessRisk({ ...r, trainsOnData: r.trainsOnData as "unknown" | "no" | "yes" });
}

/**
 * Who can decide on a step: the stage's reviewers, never the requester. With
 * nobody left (no reviewers, stage deleted, or the requester is the only one)
 * it falls back to org admins, and in a one-person org to the owner.
 */
async function reviewersByStep(db: DbLike, orgId: string, steps: Step[], requesterByStep: Map<string, string | null>) {
  const stageIds = [...new Set(steps.map((s) => s.stageId).filter((v): v is string => !!v))];
  const [members, admins] = await Promise.all([stageMembers(db, orgId, stageIds), orgAdmins(db, orgId)]);
  const result = new Map<string, Reviewer[]>();
  for (const step of steps) {
    const requester = requesterByStep.get(step.id) ?? null;
    let list: Reviewer[] = step.stageId ? members.filter((m) => m.stageId === step.stageId) : [];
    list = list.filter((m) => m.userId !== requester);
    if (list.length === 0) list = admins.filter((a) => a.userId !== requester);
    if (list.length === 0) list = admins;
    result.set(
      step.id,
      list.map(({ userId, name, email }) => ({ userId, name, email })),
    );
  }
  return result;
}

async function reviewersFor(db: DbLike, orgId: string, step: Step, requesterUserId: string | null) {
  return (await reviewersByStep(db, orgId, [step], new Map([[step.id, requesterUserId]]))).get(step.id)!;
}

/** Council stages that apply to a risk tier, in review order. */
async function stagesFor(tx: Tx, orgId: string, tier: RiskTier) {
  const stages = await tx
    .select()
    .from(aiReviewStages)
    .where(eq(aiReviewStages.organizationId, orgId))
    .orderBy(asc(aiReviewStages.position), asc(aiReviewStages.createdAt));
  return stages.filter((s) => tierRank(tier) >= tierRank(s.minTier));
}

/** Create the waiting steps after `afterPosition`, activating the first one. */
async function planSteps(tx: Tx, orgId: string, requestId: string, tier: RiskTier, skipStageIds: Set<string>, afterPosition: number) {
  const stages = (await stagesFor(tx, orgId, tier)).filter((s) => !skipStageIds.has(s.id));
  const plan = stages.length
    ? stages.map((s) => ({ stageId: s.id as string | null, name: s.name, rule: s.rule }))
    : [{ stageId: null, name: ADMIN_STEP, rule: "any" }];
  const rows = await tx
    .insert(aiRequestSteps)
    .values(
      plan.map((p, i) => ({
        organizationId: orgId,
        requestId,
        stageId: p.stageId,
        name: p.name,
        rule: p.rule,
        position: afterPosition + i + 1,
        status: i === 0 ? "active" : "waiting",
        // Database clock, like event timestamps, so approvals compare reliably.
        activatedAt: i === 0 ? sql`now()` : null,
      })),
    )
    .returning();
  return rows[0]!;
}

async function loadRequest(db: DbLike, ctx: Ctx, id: string, lock = false) {
  const q = db
    .select()
    .from(aiRequests)
    .where(and(eq(aiRequests.id, id), eq(aiRequests.organizationId, ctx.orgId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Request");
  return row;
}

async function activeStep(db: DbLike, requestId: string) {
  const [step] = await db
    .select()
    .from(aiRequestSteps)
    .where(and(eq(aiRequestSteps.requestId, requestId), eq(aiRequestSteps.status, "active")))
    .limit(1);
  return step;
}

async function requesterEmail(db: DbLike, userId: string | null) {
  if (!userId) return [];
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  return u ? [u.email] : [];
}

function reviewNotice(req: Request, step: Step, reviewers: Reviewer[]): Notice {
  return {
    to: reviewers.map((r) => r.email),
    subject: `AI tool review: ${req.title} (${step.name})`,
    intro: `"${req.title}" is waiting for the ${step.name} review. Risk tier: ${req.riskTier}. Capability: ${req.capability}.`,
    action: "Review the request",
    path: `/ai/requests/${req.id}`,
  };
}

async function addEvent(tx: Tx, ctx: Ctx, requestId: string, type: string, extra: { stepId?: string; comment?: string | null; conditions?: string | null } = {}) {
  await tx.insert(aiRequestEvents).values({
    organizationId: ctx.orgId,
    requestId,
    userId: ctx.actor.userId,
    actorLabel: ctx.actor.label,
    type,
    stepId: extra.stepId ?? null,
    comment: extra.comment ?? null,
    conditions: extra.conditions ?? null,
  });
}

export async function createRequest(ctx: Ctx, input: AiRequestInput) {
  const data = aiRequestInput.parse(input);
  const { tier } = assessRisk(data);
  const notices: Notice[] = [];
  const row = await ctx.db.transaction(async (tx) => {
    await assertInOrg(tx, systems, ctx.orgId, [data.systemId], "system");
    await assertInOrg(tx, teams, ctx.orgId, [data.teamId], "team");
    const [req] = await tx
      .insert(aiRequests)
      .values({ ...data, organizationId: ctx.orgId, requesterUserId: ctx.actor.userId, riskTier: tier, status: "in_review" })
      .returning();
    const first = await planSteps(tx, ctx.orgId, req!.id, tier, new Set(), 0);
    await addEvent(tx, ctx, req!.id, "submitted");
    await recordAudit(tx, ctx, {
      action: "create",
      entityType: "ai_request",
      entityId: req!.id,
      summary: `Requested AI tool "${req!.title}" (${tier} risk)`,
    });
    notices.push(reviewNotice(req!, first, await reviewersFor(tx, ctx.orgId, first, req!.requesterUserId)));
    return req!;
  });
  await notify(notices);
  return row;
}

/** Requester (or an admin) updates a request after changes were asked for, and sends it back for review. */
export async function resubmitRequest(ctx: Ctx, id: string, input: AiRequestInput) {
  const data = aiRequestInput.parse(input);
  const { tier } = assessRisk(data);
  const notices: Notice[] = [];
  const row = await ctx.db.transaction(async (tx) => {
    const before = await loadRequest(tx, ctx, id, true);
    if (before.requesterUserId !== ctx.actor.userId && !isAdmin(ctx)) throw forbidden("Only the requester can edit this request");
    if (before.status !== "changes_requested") throw conflict("Requests can only be edited after a reviewer asks for changes");
    await assertInOrg(tx, systems, ctx.orgId, [data.systemId], "system");
    await assertInOrg(tx, teams, ctx.orgId, [data.teamId], "team");
    const [req] = await tx
      .update(aiRequests)
      .set({ ...data, riskTier: tier, status: "in_review" })
      .where(eq(aiRequests.id, id))
      .returning();

    // Stages already passed stay passed; the rest is re-planned for the (possibly new) risk tier.
    const steps = await tx.select().from(aiRequestSteps).where(eq(aiRequestSteps.requestId, id));
    const done = steps.filter((s) => s.status === "approved");
    await tx.delete(aiRequestSteps).where(and(eq(aiRequestSteps.requestId, id), inArray(aiRequestSteps.status, ["active", "waiting"])));
    const first = await planSteps(
      tx,
      ctx.orgId,
      id,
      tier,
      new Set(done.map((s) => s.stageId).filter((v): v is string => !!v)),
      Math.max(0, ...done.map((s) => s.position)),
    );
    await addEvent(tx, ctx, id, "resubmitted");
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "ai_request",
      entityId: id,
      summary: `Resubmitted AI tool request "${req!.title}"`,
    });
    notices.push(reviewNotice(req!, first, await reviewersFor(tx, ctx.orgId, first, req!.requesterUserId)));
    return req!;
  });
  await notify(notices);
  return row;
}

export async function withdrawRequest(ctx: Ctx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const before = await loadRequest(tx, ctx, id, true);
    if (before.requesterUserId !== ctx.actor.userId && !isAdmin(ctx)) throw forbidden("Only the requester can withdraw this request");
    if (!OPEN.includes(before.status)) throw conflict("This request is already closed");
    const [req] = await tx
      .update(aiRequests)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(eq(aiRequests.id, id))
      .returning();
    await tx
      .update(aiRequestSteps)
      .set({ status: "waiting", activatedAt: null })
      .where(and(eq(aiRequestSteps.requestId, id), eq(aiRequestSteps.status, "active")));
    await addEvent(tx, ctx, id, "withdrawn");
    await recordAudit(tx, ctx, { action: "update", entityType: "ai_request", entityId: id, summary: `Withdrew AI tool request "${req!.title}"` });
    return req!;
  });
}

export async function commentOnRequest(ctx: Ctx, id: string, input: { comment: string }) {
  const { comment } = aiCommentInput.parse(input);
  const notices: Notice[] = [];
  await ctx.db.transaction(async (tx) => {
    const req = await loadRequest(tx, ctx, id);
    await addEvent(tx, ctx, id, "comment", { comment });
    if (req.requesterUserId && req.requesterUserId !== ctx.actor.userId)
      notices.push({
        to: await requesterEmail(tx, req.requesterUserId),
        subject: `New comment on your AI tool request: ${req.title}`,
        intro: `${ctx.actor.label} commented: "${comment.slice(0, 500)}"`,
        action: "View the request",
        path: `/ai/requests/${id}`,
      });
  });
  await notify(notices);
}

/**
 * Add an approved request to the inventory: link (or create) its system, give
 * the system an AI profile, and record the approved capability.
 */
async function addToInventory(tx: Tx, ctx: Ctx, req: Request, conditions: string | null) {
  let systemId = req.systemId;
  if (!systemId) {
    const [existing] = await tx
      .select({ id: systems.id })
      .from(systems)
      .where(and(eq(systems.organizationId, ctx.orgId), eq(sql`lower(${systems.name})`, req.title.toLowerCase())));
    if (existing) systemId = existing.id;
    else {
      const [created] = await tx
        .insert(systems)
        .values({
          organizationId: ctx.orgId,
          name: req.title,
          vendor: req.vendor,
          url: req.url,
          category: "AI",
          description: req.capability,
          lifecycle: "pilot",
        })
        .returning();
      systemId = created!.id;
      await recordAudit(tx, ctx, {
        action: "create",
        entityType: "system",
        entityId: systemId,
        summary: `Created system "${created!.name}" from an approved AI tool request`,
      });
    }
  }

  const now = new Date();
  const reviewDue = new Date(now);
  reviewDue.setFullYear(reviewDue.getFullYear() + 1);
  const [profile] = await tx.select().from(aiProfiles).where(eq(aiProfiles.systemId, systemId));
  if (profile) {
    await tx
      .update(aiProfiles)
      .set({
        riskTier: RISK_TIERS[Math.max(tierRank(profile.riskTier), tierRank(req.riskTier))],
        approvedAt: now,
        targetUsers: profile.targetUsers ?? req.expectedUsers,
      })
      .where(eq(aiProfiles.id, profile.id));
  } else {
    await tx.insert(aiProfiles).values({
      organizationId: ctx.orgId,
      systemId,
      riskTier: req.riskTier,
      approvedAt: now,
      reviewDueAt: reviewDue.toISOString().slice(0, 10),
      targetUsers: req.expectedUsers,
    });
  }
  await tx.insert(aiCapabilities).values({
    organizationId: ctx.orgId,
    systemId,
    name: req.capability,
    status: conditions ? "restricted" : "approved",
    notes: conditions,
    requestId: req.id,
  });
  await recordAudit(tx, ctx, {
    action: "update",
    entityType: "system",
    entityId: systemId,
    summary: `Approved AI capability "${req.capability}"${conditions ? " with conditions" : ""}`,
    changes: { requestId: req.id, riskTier: req.riskTier },
  });
  return systemId;
}

export async function decideRequest(ctx: Ctx, id: string, input: AiDecisionInput) {
  const data = aiDecisionInput.parse(input);
  const notices: Notice[] = [];
  const result = await ctx.db.transaction(async (tx) => {
    const req = await loadRequest(tx, ctx, id, true);
    if (req.status !== "in_review") throw conflict(req.status === "changes_requested" ? "Waiting for the requester to make changes" : "This request is closed");
    const step = await activeStep(tx, id);
    if (!step) throw conflict("This request has no active review step");
    const reviewers = await reviewersFor(tx, ctx.orgId, step, req.requesterUserId);
    if (!reviewers.some((r) => r.userId === ctx.actor.userId))
      throw forbidden(`Only reviewers for the ${step.name} stage can decide right now`);
    const requester = await requesterEmail(tx, req.requesterUserId);
    const link = `/ai/requests/${id}`;
    const now = new Date();

    if (data.decision === "reject") {
      await addEvent(tx, ctx, id, "rejected", { stepId: step.id, comment: data.comment });
      await tx.update(aiRequestSteps).set({ status: "rejected", completedAt: now }).where(eq(aiRequestSteps.id, step.id));
      const [row] = await tx.update(aiRequests).set({ status: "rejected", decidedAt: now }).where(eq(aiRequests.id, id)).returning();
      await recordAudit(tx, ctx, { action: "update", entityType: "ai_request", entityId: id, summary: `Rejected AI tool request "${req.title}" at ${step.name}` });
      notices.push({ to: requester, subject: `Your AI tool request was not approved: ${req.title}`, intro: `${ctx.actor.label} (${step.name}) rejected "${req.title}": ${data.comment}`, action: "View the request", path: link });
      return row!;
    }

    if (data.decision === "request_changes") {
      await addEvent(tx, ctx, id, "changes_requested", { stepId: step.id, comment: data.comment });
      const [row] = await tx.update(aiRequests).set({ status: "changes_requested" }).where(eq(aiRequests.id, id)).returning();
      await recordAudit(tx, ctx, { action: "update", entityType: "ai_request", entityId: id, summary: `Asked for changes to AI tool request "${req.title}"` });
      notices.push({ to: requester, subject: `Changes requested: ${req.title}`, intro: `${ctx.actor.label} (${step.name}) asked for changes to "${req.title}": ${data.comment}`, action: "Update the request", path: link });
      return row!;
    }

    // Approve
    const already = await tx
      .select({ userId: aiRequestEvents.userId })
      .from(aiRequestEvents)
      .where(
        and(
          eq(aiRequestEvents.stepId, step.id),
          eq(aiRequestEvents.type, "approved"),
          eq(aiRequestEvents.userId, ctx.actor.userId),
          step.activatedAt ? gt(aiRequestEvents.createdAt, step.activatedAt) : undefined,
        ),
      );
    if (already.length) throw conflict("You have already approved this stage");
    await addEvent(tx, ctx, id, "approved", { stepId: step.id, comment: data.comment, conditions: data.conditions });

    if (step.rule === "all") {
      const approvals = await tx
        .select({ userId: aiRequestEvents.userId })
        .from(aiRequestEvents)
        .where(
          and(
            eq(aiRequestEvents.stepId, step.id),
            eq(aiRequestEvents.type, "approved"),
            step.activatedAt ? gt(aiRequestEvents.createdAt, step.activatedAt) : undefined,
          ),
        );
      const approved = new Set(approvals.map((a) => a.userId));
      if (!reviewers.every((r) => approved.has(r.userId))) return req; // waiting on the rest of the stage
    }

    await tx.update(aiRequestSteps).set({ status: "approved", completedAt: now }).where(eq(aiRequestSteps.id, step.id));
    const [next] = await tx
      .select()
      .from(aiRequestSteps)
      .where(and(eq(aiRequestSteps.requestId, id), eq(aiRequestSteps.status, "waiting")))
      .orderBy(asc(aiRequestSteps.position))
      .limit(1);
    if (next) {
      const [activated] = await tx.update(aiRequestSteps).set({ status: "active", activatedAt: sql`now()` }).where(eq(aiRequestSteps.id, next.id)).returning();
      notices.push(reviewNotice(req, activated!, await reviewersFor(tx, ctx.orgId, activated!, req.requesterUserId)));
      return req;
    }

    // Final stage approved.
    const conditionRows = await tx
      .select({ conditions: aiRequestEvents.conditions })
      .from(aiRequestEvents)
      .where(and(eq(aiRequestEvents.requestId, id), eq(aiRequestEvents.type, "approved")))
      .orderBy(asc(aiRequestEvents.createdAt));
    const conditions = conditionRows.map((r) => r.conditions).filter(Boolean).join("\n") || null;
    const systemId = await addToInventory(tx, ctx, req, conditions);
    const [row] = await tx
      .update(aiRequests)
      .set({ status: "approved", decidedAt: now, conditions, resultSystemId: systemId })
      .where(eq(aiRequests.id, id))
      .returning();
    await recordAudit(tx, ctx, { action: "update", entityType: "ai_request", entityId: id, summary: `Approved AI tool request "${req.title}"` });
    notices.push({
      to: requester,
      subject: `Approved: ${req.title}`,
      intro: `The AI council approved "${req.title}" for ${req.capability}.${conditions ? ` Conditions: ${conditions}` : ""}`,
      action: "View the request",
      path: link,
    });
    return row!;
  });
  await notify(notices);
  return result;
}

const listColumns = {
  request: aiRequests,
  requesterName: user.name,
  teamName: teams.name,
  systemName: systems.name,
};

/** Ids of open requests the caller can decide on right now. */
async function awaitingFor(ctx: Ctx, rows: { request: Request }[]) {
  const open = rows.filter((r) => r.request.status === "in_review");
  if (open.length === 0) return new Map<string, Step>();
  const steps = await ctx.db
    .select()
    .from(aiRequestSteps)
    .where(and(inArray(aiRequestSteps.requestId, open.map((r) => r.request.id)), eq(aiRequestSteps.status, "active")));
  const requesterByStep = new Map(steps.map((s) => [s.id, open.find((r) => r.request.id === s.requestId)!.request.requesterUserId]));
  const reviewers = await reviewersByStep(ctx.db, ctx.orgId, steps, requesterByStep);
  const result = new Map<string, Step & { awaitingMe: boolean }>();
  for (const s of steps) result.set(s.requestId, { ...s, awaitingMe: !!reviewers.get(s.id)?.some((r) => r.userId === ctx.actor.userId) });
  return result;
}

export async function listRequests(ctx: Ctx, opts: { q?: string; status?: string; mine?: boolean; awaiting?: boolean } = {}) {
  const rows = await ctx.db
    .select(listColumns)
    .from(aiRequests)
    .leftJoin(user, eq(user.id, aiRequests.requesterUserId))
    .leftJoin(teams, eq(teams.id, aiRequests.teamId))
    .leftJoin(systems, eq(systems.id, aiRequests.systemId))
    .where(
      and(
        eq(aiRequests.organizationId, ctx.orgId),
        opts.status ? eq(aiRequests.status, opts.status) : undefined,
        opts.mine ? eq(aiRequests.requesterUserId, ctx.actor.userId) : undefined,
        opts.awaiting ? eq(aiRequests.status, "in_review") : undefined,
        textSearch(opts.q, aiRequests.title, aiRequests.vendor, aiRequests.capability),
      ),
    )
    .orderBy(desc(aiRequests.submittedAt));
  const active = await awaitingFor(ctx, rows);
  const list = rows.map((r) => {
    const step = active.get(r.request.id) as (Step & { awaitingMe: boolean }) | undefined;
    return {
      ...r.request,
      requesterName: r.requesterName,
      teamName: r.teamName,
      systemName: r.systemName,
      currentStep: step?.name ?? null,
      awaitingMe: step?.awaitingMe ?? false,
    };
  });
  return opts.awaiting ? list.filter((r) => r.awaitingMe) : list;
}

export async function getRequest(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select(listColumns)
    .from(aiRequests)
    .leftJoin(user, eq(user.id, aiRequests.requesterUserId))
    .leftJoin(teams, eq(teams.id, aiRequests.teamId))
    .leftJoin(systems, eq(systems.id, aiRequests.systemId))
    .where(and(eq(aiRequests.id, id), eq(aiRequests.organizationId, ctx.orgId)));
  if (!row) throw notFound("Request");
  const req = row.request;
  const [steps, events, resultSystem] = await Promise.all([
    ctx.db.select().from(aiRequestSteps).where(eq(aiRequestSteps.requestId, id)).orderBy(asc(aiRequestSteps.position)),
    ctx.db.select().from(aiRequestEvents).where(eq(aiRequestEvents.requestId, id)).orderBy(asc(aiRequestEvents.createdAt)),
    req.resultSystemId
      ? ctx.db.select({ id: systems.id, name: systems.name }).from(systems).where(eq(systems.id, req.resultSystemId)).then((r) => r[0] ?? null)
      : null,
  ]);
  const reviewers = await reviewersByStep(ctx.db, ctx.orgId, steps, new Map(steps.map((s) => [s.id, req.requesterUserId])));
  const active = steps.find((s) => s.status === "active");
  const canDecide = req.status === "in_review" && !!active && !!reviewers.get(active.id)?.some((r) => r.userId === ctx.actor.userId);
  const isRequester = req.requesterUserId === ctx.actor.userId;
  return {
    ...req,
    requesterName: row.requesterName,
    teamName: row.teamName,
    systemName: row.systemName,
    resultSystem,
    risk: riskOf(req),
    steps: steps.map((s) => {
      const approvals = events.filter(
        (e) => e.stepId === s.id && e.type === "approved" && (!s.activatedAt || e.createdAt > s.activatedAt),
      );
      return {
        ...s,
        reviewers: (reviewers.get(s.id) ?? []).map(({ userId, name }) => ({ userId, name })),
        approvedBy: approvals.map((e) => e.userId),
      };
    }),
    events,
    permissions: {
      canDecide,
      alreadyApproved:
        canDecide && events.some((e) => e.stepId === active!.id && e.type === "approved" && e.userId === ctx.actor.userId && (!active!.activatedAt || e.createdAt > active!.activatedAt)),
      canEdit: req.status === "changes_requested" && (isRequester || isAdmin(ctx)),
      canWithdraw: OPEN.includes(req.status) && (isRequester || isAdmin(ctx)),
    },
  };
}

export function assertKnownStatus(status: string | undefined) {
  if (status && !["in_review", "changes_requested", "approved", "rejected", "withdrawn"].includes(status)) throw badRequest("Unknown status");
}
