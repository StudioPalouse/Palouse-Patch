import { and, asc, count, eq, inArray } from "drizzle-orm";
import { artifacts, people, systemOwners, systems, useCaseSystems, useCases } from "../db/schema.ts";
import {
  label,
  systemInput,
  systemOwnerInput,
  type SystemInput,
  type SystemOwnerInput,
} from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import type { Ctx } from "./context.ts";
import { mapDbError, notFound } from "./errors.ts";
import { personAccess } from "./people.ts";
import { textSearch } from "./util.ts";

const DUPLICATE = "A system with that name already exists";

async function ownersFor(ctx: Ctx, systemIds: string[]) {
  if (systemIds.length === 0) return [];
  return ctx.db
    .select({
      id: systemOwners.id,
      systemId: systemOwners.systemId,
      role: systemOwners.role,
      personId: people.id,
      name: people.name,
      email: people.email,
      access: personAccess,
    })
    .from(systemOwners)
    .innerJoin(people, eq(people.id, systemOwners.personId))
    .where(inArray(systemOwners.systemId, systemIds))
    .orderBy(asc(people.name));
}

export async function listSystems(
  ctx: Ctx,
  opts: { q?: string; lifecycle?: string; isPlatform?: boolean } = {},
) {
  const artifactCount = ctx.db
    .select({ systemId: artifacts.systemId, n: count().as("artifact_count") })
    .from(artifacts)
    .where(eq(artifacts.organizationId, ctx.orgId))
    .groupBy(artifacts.systemId)
    .as("ac");
  const useCaseCount = ctx.db
    .select({ systemId: useCaseSystems.systemId, n: count().as("use_case_count") })
    .from(useCaseSystems)
    .groupBy(useCaseSystems.systemId)
    .as("ucc");
  const rows = await ctx.db
    .select({ system: systems, artifactCount: artifactCount.n, useCaseCount: useCaseCount.n })
    .from(systems)
    .leftJoin(artifactCount, eq(artifactCount.systemId, systems.id))
    .leftJoin(useCaseCount, eq(useCaseCount.systemId, systems.id))
    .where(
      and(
        eq(systems.organizationId, ctx.orgId),
        opts.lifecycle ? eq(systems.lifecycle, opts.lifecycle) : undefined,
        opts.isPlatform !== undefined ? eq(systems.isPlatform, opts.isPlatform) : undefined,
        textSearch(opts.q, systems.name, systems.vendor, systems.category, systems.description),
      ),
    )
    .orderBy(asc(systems.name));
  const owners = await ownersFor(
    ctx,
    rows.map((r) => r.system.id),
  );
  return rows.map((r) => ({
    ...r.system,
    artifactCount: r.artifactCount ?? 0,
    useCaseCount: r.useCaseCount ?? 0,
    owners: owners.filter((o) => o.systemId === r.system.id),
  }));
}

export async function getSystem(ctx: Ctx, id: string) {
  const system = await ctx.db.query.systems.findFirst({
    where: and(eq(systems.id, id), eq(systems.organizationId, ctx.orgId)),
  });
  if (!system) throw notFound("System");
  const [owners, linkedUseCases, systemArtifacts] = await Promise.all([
    ownersFor(ctx, [id]),
    ctx.db
      .select({ useCase: useCases })
      .from(useCaseSystems)
      .innerJoin(useCases, eq(useCases.id, useCaseSystems.useCaseId))
      .where(eq(useCaseSystems.systemId, id))
      .orderBy(asc(useCases.title)),
    ctx.db
      .select({ artifact: artifacts, ownerName: people.name })
      .from(artifacts)
      .leftJoin(people, eq(people.id, artifacts.ownerId))
      .where(eq(artifacts.systemId, id))
      .orderBy(asc(artifacts.name)),
  ]);
  return {
    ...system,
    owners,
    useCases: linkedUseCases.map((r) => r.useCase),
    artifacts: systemArtifacts.map((r) => ({ ...r.artifact, ownerName: r.ownerName })),
  };
}

export async function createSystem(ctx: Ctx, input: SystemInput) {
  const data = systemInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      const [row] = await tx.insert(systems).values({ ...data, organizationId: ctx.orgId }).returning();
      await recordAudit(tx, ctx, {
        action: "create",
        entityType: "system",
        entityId: row!.id,
        summary: `Created system "${row!.name}"`,
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: DUPLICATE }));
}

export async function updateSystem(ctx: Ctx, id: string, input: SystemInput) {
  const data = systemInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      const before = await tx.query.systems.findFirst({
        where: and(eq(systems.id, id), eq(systems.organizationId, ctx.orgId)),
      });
      if (!before) throw notFound("System");
      const [row] = await tx.update(systems).set(data).where(eq(systems.id, id)).returning();
      await recordAudit(tx, ctx, {
        action: "update",
        entityType: "system",
        entityId: id,
        summary: `Updated system "${row!.name}"`,
        changes: diff(before, row!),
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: DUPLICATE }));
}

export async function deleteSystem(ctx: Ctx, id: string) {
  await ctx.db
    .transaction(async (tx) => {
      const [row] = await tx
        .delete(systems)
        .where(and(eq(systems.id, id), eq(systems.organizationId, ctx.orgId)))
        .returning();
      if (!row) throw notFound("System");
      await recordAudit(tx, ctx, {
        action: "delete",
        entityType: "system",
        entityId: id,
        summary: `Deleted system "${row.name}"`,
      });
    })
    .catch((e) =>
      mapDbError(e, {
        foreignKey: "This system still has artifacts. Move or delete them first.",
      }),
    );
}

export async function addSystemOwner(ctx: Ctx, systemId: string, input: SystemOwnerInput) {
  const data = systemOwnerInput.parse(input);
  return ctx.db
    .transaction(async (tx) => {
      const system = await tx.query.systems.findFirst({
        where: and(eq(systems.id, systemId), eq(systems.organizationId, ctx.orgId)),
      });
      if (!system) throw notFound("System");
      const person = await tx.query.people.findFirst({
        where: and(eq(people.id, data.personId), eq(people.organizationId, ctx.orgId)),
      });
      if (!person) throw notFound("Person");
      const [row] = await tx
        .insert(systemOwners)
        .values({ organizationId: ctx.orgId, systemId, personId: person.id, role: data.role })
        .returning();
      await recordAudit(tx, ctx, {
        action: "update",
        entityType: "system",
        entityId: systemId,
        summary: `Added ${person.name} as ${label(data.role).toLowerCase()} of "${system.name}"`,
        changes: { owner: { personId: person.id, role: data.role } },
      });
      return row!;
    })
    .catch((e) => mapDbError(e, { unique: "That person already has that role on this system" }));
}

export async function removeSystemOwner(ctx: Ctx, systemId: string, ownershipId: string) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(systemOwners)
      .where(
        and(
          eq(systemOwners.id, ownershipId),
          eq(systemOwners.systemId, systemId),
          eq(systemOwners.organizationId, ctx.orgId),
        ),
      )
      .returning();
    if (!row) throw notFound("Owner");
    const [person, system] = await Promise.all([
      tx.query.people.findFirst({ where: eq(people.id, row.personId) }),
      tx.query.systems.findFirst({ where: eq(systems.id, systemId) }),
    ]);
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "system",
      entityId: systemId,
      summary: `Removed ${person?.name ?? "owner"} as ${label(row.role).toLowerCase()} of "${system?.name}"`,
      changes: { ownerRemoved: { personId: row.personId, role: row.role } },
    });
  });
}
