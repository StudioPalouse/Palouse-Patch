import { and, asc, count, eq } from "drizzle-orm";
import { people, teams, useCases } from "../db/schema.ts";
import { teamInput, type TeamInput } from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import type { Ctx } from "./context.ts";
import { mapDbError, notFound } from "./errors.ts";
import { textSearch } from "./util.ts";

const DUPLICATE = "A team with that name already exists";

export async function listTeams(ctx: Ctx, opts: { q?: string } = {}) {
  const peopleCount = ctx.db
    .select({ teamId: people.teamId, n: count().as("people_count") })
    .from(people)
    .where(eq(people.organizationId, ctx.orgId))
    .groupBy(people.teamId)
    .as("pc");
  const useCaseCount = ctx.db
    .select({ teamId: useCases.teamId, n: count().as("use_case_count") })
    .from(useCases)
    .where(eq(useCases.organizationId, ctx.orgId))
    .groupBy(useCases.teamId)
    .as("uc");
  const rows = await ctx.db
    .select({ team: teams, peopleCount: peopleCount.n, useCaseCount: useCaseCount.n })
    .from(teams)
    .leftJoin(peopleCount, eq(peopleCount.teamId, teams.id))
    .leftJoin(useCaseCount, eq(useCaseCount.teamId, teams.id))
    .where(and(eq(teams.organizationId, ctx.orgId), textSearch(opts.q, teams.name, teams.description)))
    .orderBy(asc(teams.name));
  return rows.map((r) => ({ ...r.team, peopleCount: r.peopleCount ?? 0, useCaseCount: r.useCaseCount ?? 0 }));
}

export async function getTeam(ctx: Ctx, id: string) {
  const team = await ctx.db.query.teams.findFirst({
    where: and(eq(teams.id, id), eq(teams.organizationId, ctx.orgId)),
  });
  if (!team) throw notFound("Team");
  const [members, teamUseCases] = await Promise.all([
    ctx.db.select().from(people).where(eq(people.teamId, id)).orderBy(asc(people.name)),
    ctx.db.select().from(useCases).where(eq(useCases.teamId, id)).orderBy(asc(useCases.title)),
  ]);
  return { ...team, people: members, useCases: teamUseCases };
}

export async function createTeam(ctx: Ctx, input: TeamInput) {
  const data = teamInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      const [row] = await tx.insert(teams).values({ ...data, organizationId: ctx.orgId }).returning();
      await recordAudit(tx, ctx, {
        action: "create",
        entityType: "team",
        entityId: row!.id,
        summary: `Created team "${row!.name}"`,
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: DUPLICATE }));
}

export async function updateTeam(ctx: Ctx, id: string, input: TeamInput) {
  const data = teamInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      const before = await tx.query.teams.findFirst({
        where: and(eq(teams.id, id), eq(teams.organizationId, ctx.orgId)),
      });
      if (!before) throw notFound("Team");
      const [row] = await tx.update(teams).set(data).where(eq(teams.id, id)).returning();
      await recordAudit(tx, ctx, {
        action: "update",
        entityType: "team",
        entityId: id,
        summary: `Updated team "${row!.name}"`,
        changes: diff(before, row!),
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: DUPLICATE }));
}

export async function deleteTeam(ctx: Ctx, id: string) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(teams)
      .where(and(eq(teams.id, id), eq(teams.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Team");
    await recordAudit(tx, ctx, {
      action: "delete",
      entityType: "team",
      entityId: id,
      summary: `Deleted team "${row.name}"`,
    });
  });
}
