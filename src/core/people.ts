import { and, asc, eq } from "drizzle-orm";
import { artifacts, people, systemOwners, systems, teams } from "../db/schema.ts";
import { personInput, type PersonInput } from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import type { Ctx } from "./context.ts";
import { mapDbError, notFound } from "./errors.ts";
import { assertInOrg, textSearch } from "./util.ts";

const DUPLICATE = "A person with that email already exists";

export async function listPeople(ctx: Ctx, opts: { q?: string; teamId?: string } = {}) {
  const rows = await ctx.db
    .select({ person: people, teamName: teams.name })
    .from(people)
    .leftJoin(teams, eq(teams.id, people.teamId))
    .where(
      and(
        eq(people.organizationId, ctx.orgId),
        opts.teamId ? eq(people.teamId, opts.teamId) : undefined,
        textSearch(opts.q, people.name, people.email, people.title),
      ),
    )
    .orderBy(asc(people.name));
  return rows.map((r) => ({ ...r.person, teamName: r.teamName }));
}

export async function getPerson(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ person: people, teamName: teams.name })
    .from(people)
    .leftJoin(teams, eq(teams.id, people.teamId))
    .where(and(eq(people.id, id), eq(people.organizationId, ctx.orgId)));
  if (!row) throw notFound("Person");
  const [owned, ownedArtifacts] = await Promise.all([
    ctx.db
      .select({ ownershipId: systemOwners.id, role: systemOwners.role, system: systems })
      .from(systemOwners)
      .innerJoin(systems, eq(systems.id, systemOwners.systemId))
      .where(eq(systemOwners.personId, id))
      .orderBy(asc(systems.name)),
    ctx.db
      .select({ artifact: artifacts, systemName: systems.name })
      .from(artifacts)
      .innerJoin(systems, eq(systems.id, artifacts.systemId))
      .where(eq(artifacts.ownerId, id))
      .orderBy(asc(artifacts.name)),
  ]);
  return {
    ...row.person,
    teamName: row.teamName,
    systems: owned.map((o) => ({ ...o.system, ownershipId: o.ownershipId, role: o.role })),
    artifacts: ownedArtifacts.map((a) => ({ ...a.artifact, systemName: a.systemName })),
  };
}

export async function createPerson(ctx: Ctx, input: PersonInput) {
  const data = personInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      await assertInOrg(tx, teams, ctx.orgId, [data.teamId], "team");
      const [row] = await tx.insert(people).values({ ...data, organizationId: ctx.orgId }).returning();
      await recordAudit(tx, ctx, {
        action: "create",
        entityType: "person",
        entityId: row!.id,
        summary: `Added person "${row!.name}"`,
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: DUPLICATE }));
}

export async function updatePerson(ctx: Ctx, id: string, input: PersonInput) {
  const data = personInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      const before = await tx.query.people.findFirst({
        where: and(eq(people.id, id), eq(people.organizationId, ctx.orgId)),
      });
      if (!before) throw notFound("Person");
      await assertInOrg(tx, teams, ctx.orgId, [data.teamId], "team");
      const [row] = await tx.update(people).set(data).where(eq(people.id, id)).returning();
      await recordAudit(tx, ctx, {
        action: "update",
        entityType: "person",
        entityId: id,
        summary: `Updated person "${row!.name}"`,
        changes: diff(before, row!),
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: DUPLICATE }));
}

export async function deletePerson(ctx: Ctx, id: string) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(people)
      .where(and(eq(people.id, id), eq(people.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Person");
    await recordAudit(tx, ctx, {
      action: "delete",
      entityType: "person",
      entityId: id,
      summary: `Removed person "${row.name}"`,
    });
  });
}
