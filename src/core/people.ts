import { and, asc, eq, or, sql } from "drizzle-orm";
import { artifacts, invitation, member, people, systemOwners, systems, teams } from "../db/schema.ts";
import { personInput, type PersonInput } from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import type { DB } from "../db/client.ts";
import type { Ctx, Tx } from "./context.ts";
import { mapDbError, notFound } from "./errors.ts";
import { assertInOrg, textSearch } from "./util.ts";

const DUPLICATE = "A person with that email already exists";

export type PatchAccess = "member" | "invited" | "none";

/**
 * Whether a person can sign in to this org: linked to a current member, has a
 * pending invitation for their email, or neither (named in the catalog only).
 */
export const personAccess = sql<PatchAccess>`case
  when exists (select 1 from ${member} where ${member.organizationId} = ${people.organizationId} and ${member.userId} = ${people.userId}) then 'member'
  when ${people.email} is not null and exists (
    select 1 from ${invitation}
    where ${invitation.organizationId} = ${people.organizationId}
      and lower(${invitation.email}) = ${people.email}
      and ${invitation.status} = 'pending'
      and ${invitation.expiresAt} > now()
  ) then 'invited'
  else 'none' end`;

/**
 * Called when someone joins an org (creates it, accepts an invitation, or is
 * added). Links them to the person with the same email, so ownerships made
 * before they joined carry over, or adds them to the directory.
 */
export async function linkMemberToPerson(db: DB | Tx, orgId: string, u: { id: string; name: string; email: string }) {
  const email = u.email.trim().toLowerCase();
  const [match] = await db
    .select({ id: people.id, userId: people.userId })
    .from(people)
    .where(and(eq(people.organizationId, orgId), or(eq(people.userId, u.id), eq(people.email, email))))
    .orderBy(sql`${people.userId} = ${u.id} desc nulls last`)
    .limit(1);
  if (match) {
    if (match.userId !== u.id) await db.update(people).set({ userId: u.id }).where(eq(people.id, match.id));
    return match.id;
  }
  const [row] = await db
    .insert(people)
    .values({ organizationId: orgId, name: u.name || email, email, userId: u.id })
    .onConflictDoNothing()
    .returning({ id: people.id });
  return row?.id ?? null;
}

export async function listPeople(ctx: Ctx, opts: { q?: string; teamId?: string } = {}) {
  const rows = await ctx.db
    .select({ person: people, teamName: teams.name, access: personAccess })
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
  return rows.map((r) => ({ ...r.person, teamName: r.teamName, access: r.access }));
}

export async function getPerson(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ person: people, teamName: teams.name, access: personAccess })
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
    access: row.access,
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
